from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import json
import unittest
from flask import Flask
from openpyxl import Workbook
from production_export import register_production_export


def report(rows, headers=None):
    book=Workbook()
    book.active.append(headers or ['Order Number','Completed Time (hours)'])
    for row in rows: book.active.append(row)
    data=BytesIO();book.save(data);book.close();data.seek(0)
    return data


class CompletionBatchTests(unittest.TestCase):
    def test_batch_deduplicates_and_excludes_all_conflicts(self):
        with TemporaryDirectory() as folder:
            workspace=SimpleNamespace(store=SimpleNamespace(root=Path(folder)/'previews'))
            app=Flask(__name__)
            app.config['MAX_CONTENT_LENGTH']=256  # The batch route must override the single-file limit.
            register_production_export(app,workspace,lambda _:None)
            response=app.test_client().post('/api/production-report/completion-upload',data={'files':[
                (report([['A','11/7/2026'],['B','11/7/2026'],['C','11/7/2026'],['C','11/8/2026']]),'one.xlsx'),
                (report([['A','11/7/2026'],['B','11/8/2026'],['C','11/7/2026'],['D','11/8/2026']]),'two.xlsx')]})
            self.assertEqual(response.status_code,200,response.json)
            self.assertEqual(response.json['files'],2)
            self.assertEqual(response.json['orders'],2)
            self.assertEqual(response.json['conflicts'],2)
            self.assertEqual([row['Order Number'] for row in response.json['completion_rows']],['A','D'])
            self.assertEqual([row['Order Number'] for row in response.json['conflict_rows']],['B','C'])
            for name, rows in {
                'Full Search': [[671, 'a', 'Full Title', 'Completed'], [749, 'B', 'Full Title', 'Completed']],
                'C-O and Update': [[23, 'B', 'Current Owner', 'Completed'], [24, 'Other', 'Current Owner', 'Completed'],
                                   [None, 'C', 'Current Owner', 'Completed']]
            }.items():
                data = report(rows, ['No', 'Order Number', 'Product', 'Status'])
                (Path(folder)/f'TV Search Production Report {name}.xlsx').write_bytes(data.getvalue())
            serials = app.test_client().post('/api/production-report/completion-serials', json={
                'token': response.json['token'], 'folder': folder
            })
            self.assertEqual(serials.status_code, 200, serials.json)
            self.assertEqual(serials.json['serials'], {'a': '671', 'b': '749, 23', 'c': ''})
            conflict = response.json['conflict_rows'][1]['Reported times (U.S. Central)']
            self.assertIn('2026-11-07 00:00:00 (one.xlsx, two.xlsx)',conflict)
            self.assertIn('2026-11-08 00:00:00 (one.xlsx)',conflict)
            saved=Path(folder)/'production-exports/completion-uploads'/(response.json['token']+'.json')
            self.assertEqual(set(json.loads(saved.read_text())),{'a','d'})

            # Test resolving conflict B
            res = app.test_client().post('/api/production-report/resolve-conflicts', json={
                'token': response.json['token'],
                'resolutions': [{
                    'order_number': 'B',
                    'time_ist': '2026-11-07 11:30:00',
                    'source_file': 'one.xlsx'
                }]
            })
            self.assertEqual(res.status_code, 200, res.json)
            self.assertEqual(res.json['orders'], 3)
            self.assertEqual(res.json['conflicts'], 1)
            self.assertEqual(set(json.loads(saved.read_text())), {'a', 'd', 'b'})
            self.assertEqual([row['Order Number'] for row in res.json['conflict_rows']], ['C'])
            resolved_row = next(r for r in res.json['completion_rows'] if r['Order Number'] == 'B')
            self.assertEqual(resolved_row['Completion time (IST)'], '2026-11-07 11:30:00')

    def test_batch_captures_products_and_resolves_via_action_route(self):
        with TemporaryDirectory() as folder:
            workspace=SimpleNamespace(store=SimpleNamespace(root=Path(folder)/'previews'))
            app=Flask(__name__)
            register_production_export(app,workspace,lambda _:None)
            headers = ['Order Number', 'Product', 'Completed Time (hours)']
            response = app.test_client().post('/api/production-report/completion-upload', data={'files': [
                (report([['ORD-1', 'Two Owner', '11/7/2026 10:00:00'], ['ORD-2', 'Full Title', '11/7/2026 12:00:00']], headers), 'rep1.xlsx'),
                (report([['ORD-2', 'Update', '11/7/2026 15:00:00']], headers), 'rep2.xlsx'),
            ]})
            self.assertEqual(response.status_code, 200, response.json)
            self.assertEqual(response.json['orders'], 1)
            self.assertEqual(response.json['conflicts'], 1)
            # Check Product in completion_rows
            self.assertEqual(response.json['completion_rows'][0]['Order Number'], 'ORD-1')
            self.assertEqual(response.json['completion_rows'][0]['Product'], 'Two Owner')
            # Check Products and candidates product in conflict_rows
            conflict = response.json['conflict_rows'][0]
            self.assertEqual(conflict['Order Number'], 'ORD-2')
            self.assertEqual(conflict['Products'], 'Full Title, Update')
            self.assertEqual(len(conflict['candidates']), 2)
            self.assertEqual(conflict['candidates'][0]['product'], 'Full Title')
            self.assertEqual(conflict['candidates'][1]['product'], 'Update')

            multiple = app.test_client().post('/api/production-report/resolve-product-conflicts', json={
                'token': response.json['token'],
                'resolutions': [{'order_number': 'ORD-2', 'product': candidate['product'],
                                 'time_central': candidate['time_central'], 'time_ist': candidate['time_ist']}
                                for candidate in conflict['candidates']]
            })
            self.assertEqual(multiple.status_code, 200, multiple.json)
            self.assertNotEqual(multiple.json['token'], response.json['token'])
            self.assertEqual(multiple.json['orders'], 2)
            resolved = next(row for row in multiple.json['completion_rows'] if row['Order Number'] == 'ORD-2')
            self.assertEqual(resolved['Completion time (IST)'], '\n'.join(
                f"{candidate['product']}: {candidate['time_ist']}" for candidate in conflict['candidates']))

            # Test resolving conflict via /api/production-report/resolve-conflicts AND via action route
            res_action = app.test_client().post('/api/production-report/resolve-conflicts', json={
                'token': response.json['token'],
                'resolutions': [{
                    'order_number': 'ORD-2',
                    'time_ist': '2026-11-07 23:30:00',
                    'source_file': 'rep1.xlsx'
                }]
            })
            self.assertEqual(res_action.status_code, 200, res_action.json)
            self.assertEqual(res_action.json['orders'], 2)
            self.assertEqual(res_action.json['conflicts'], 0)
            res_ord2 = next(r for r in res_action.json['completion_rows'] if r['Order Number'] == 'ORD-2')
            self.assertEqual(res_ord2['Product'], 'Full Title, Update')
            self.assertEqual(res_ord2['Completion time (IST)'], '2026-11-07 23:30:00')

    def test_versioned_move_preserves_both_export_states(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            app = Flask(__name__)
            register_production_export(app, SimpleNamespace(store=SimpleNamespace(root=root/'previews')), lambda _: None)
            client = app.test_client()
            upload = client.post('/api/production-report/completion-upload', data={'files': [
                (report([['A', '11/7/2026']]), 'one.xlsx'),
                (report([['A', '11/8/2026']]), 'two.xlsx'),
            ]}).json
            moved = client.post('/api/production-report/resolve-conflicts-version', json={
                'token': upload['token'],
                'resolutions': [{
                    'order_number': 'A',
                    'time_central': '2026-11-08 00:00:00',
                    'time_ist': '2026-11-08 11:45:00',
                }],
            })
            self.assertEqual(moved.status_code, 200, moved.json)
            self.assertNotEqual(upload['token'], moved.json['token'])
            self.assertEqual(moved.json['conflict_rows'], [])
            self.assertEqual(moved.json['completion_rows'][0]['Source files'], 'two.xlsx')
            directory = root/'production-exports'/'completion-uploads'
            self.assertEqual(json.loads((directory/(upload['token']+'.json')).read_text()), {})
            self.assertEqual(json.loads((directory/(moved.json['token']+'.json')).read_text()),
                             {'a': '2026-11-08T11:45:00'})

    def test_invalid_batch_does_not_publish_partial_upload(self):
        with TemporaryDirectory() as folder:
            app=Flask(__name__)
            register_production_export(app,SimpleNamespace(store=SimpleNamespace(root=Path(folder)/'previews')),lambda _:None)
            response=app.test_client().post('/api/production-report/completion-upload',data={'files':[
                (report([['A','11/7/2026']]),'good.xlsx'),(BytesIO(b'invalid'),'bad.xlsx')]})
            self.assertEqual(response.status_code,400)
            self.assertFalse(list(Path(folder).rglob('*.json')))
