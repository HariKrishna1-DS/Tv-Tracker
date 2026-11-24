import {test,expect} from '@playwright/test';
import {workspaceFixture} from './workspace-fixture.js';

test('Completed in TV shows both report KPIs and reviews matched noncompleted orders',async({page})=>{
  const fixture=workspaceFixture(3),requests=[];
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let body=fixture.response(path);
    if(path==='/api/production-report')body={folder:'C:\\Reports',previews:fixture.previews,selected_preview_id:32};
    if(path.endsWith('/check')||path.endsWith('/proceed')){
      const request=route.request().postDataJSON();requests.push(request);
      body={export_options_version:1,export_options:request.export_options,fingerprint:'checked',candidate_fingerprint:'stable',
        rows:[],columns:['Order Number','Status'],unresolved:[],downloads:[],completed:path.endsWith('/proceed'),
        reports:['full','co'].map(kind=>({kind,name:kind+'.xlsx',missing:0,orders:[],completed_tv_count:1,
          completed_tv_orders:[{'Order Number':kind+'-TV','PreviousStatus':'QC in Progress',Status:'Completed and Delivered',
            'Previous Out Time':'','Out Time':'2026-11-06T08:30:00'}]}))};
    }
    await route.fulfill({json:body});
  });
  await page.goto('/');await page.getByRole('button',{name:'Production Report',exact:true}).click();
  await expect(page.getByRole('switch',{name:'Completed in TV',exact:true})).toHaveAttribute('aria-checked','true');
  await page.locator('.production-export-options').screenshot({path:'test-results/excel-update-options.png'});
  await page.getByRole('button',{name:'Check folder & orders',exact:true}).click();
  for(const [name,kind] of [['Full Search','full'],['C-O and Update','co']]){
    await page.getByRole('button',{name:`${name}: Completed in TV, 1 orders`,exact:true}).click();
    const dialog=page.getByRole('dialog',{name:`${name} — Matched Orders Not Marked as Completed in Production Reports`});
    await expect(dialog.getByRole('cell',{name:kind+'-TV',exact:true})).toBeVisible();
    await expect(dialog.getByRole('cell',{name:'QC in Progress',exact:true})).toBeVisible();
    await expect(dialog.getByRole('cell',{name:'Completed and Delivered',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await page.screenshot({path:'test-results/completed-tv-kpis.png',fullPage:true});
  await page.getByRole('button',{name:'Proceed — update selected orders',exact:true}).click();
  await expect(page.getByText('Excel updated successfully',{exact:true})).toBeVisible();
  expect(requests.at(-1).export_options.completed_tv).toBe(true);
});

for(const outdatedAt of [1,2])test(`an older export server is blocked at check ${outdatedAt} before Excel writes`,async({page})=>{
  const fixture=workspaceFixture(3);let checks=0,writes=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let body=fixture.response(path);
    if(path==='/api/production-report')body={folder:'C:\\Reports',previews:fixture.previews,selected_preview_id:32};
    if(path.endsWith('/check')){
      checks++;body={fingerprint:'checked',columns:[],rows:[],reports:[],unresolved:[]};
      if(checks<outdatedAt)Object.assign(body,{export_options_version:1,export_options:route.request().postDataJSON().export_options});
    }
    if(path.endsWith('/proceed'))writes++;
    await route.fulfill({json:body});
  });
  await page.goto('/');await page.getByRole('button',{name:'Production Report',exact:true}).click();
  await page.getByRole('button',{name:'Check folder & orders',exact:true}).click();
  const proceed=page.getByRole('button',{name:'Proceed — update selected orders',exact:true});
  if(outdatedAt===2){
    await expect(proceed).toBeEnabled();
    await page.getByRole('switch',{name:'Newly orders',exact:true}).click();
    await page.getByRole('switch',{name:'Status changed',exact:true}).click();
    await proceed.click();
  }else await expect(proceed).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('Restart the app');
  expect(writes).toBe(0);
});

test('export switches keep both reports visible and submit completion-only options',async({page})=>{
  const fixture=workspaceFixture(3),requests=[];
  await page.route('**/api/**',async route=>{
    const name=new URL(route.request().url()).pathname;
    let body=fixture.response(name);
    if(name==='/api/production-report')body={folder:'C:\\Reports',previews:fixture.previews,selected_preview_id:32};
    if(name.endsWith('/check')||name.endsWith('/proceed')){
      requests.push(route.request().postDataJSON());
      body={fingerprint:'checked',preview_name:'preview32',columns:[],rows:[],reports:['full','co'].map(kind=>({kind,name:kind+'.xlsx',sheet:'Orders',missing:3,orders:[],status_changed:4,changed_orders:[],completion_count:9,completion_orders:[]})),unresolved:[],completed:name.endsWith('/proceed'),downloads:[]};
    }
    if(name.endsWith('/check')||name.endsWith('/proceed'))body={...body,export_options_version:1,export_options:route.request().postDataJSON().export_options,candidate_fingerprint:'stable'};
    await route.fulfill({json:body});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Production Report',exact:true}).click();
  const check=page.getByRole('button',{name:'Check folder & orders',exact:true});
  const proceed=page.getByRole('button',{name:'Proceed — update selected orders',exact:true});
  await check.click();
  await expect(proceed).toBeEnabled();
  await page.getByRole('switch',{name:'Newly orders',exact:true}).click();
  await expect(proceed).toBeEnabled();
  await expect(page.locator('.production-report-files article')).toHaveCount(2);
  await page.getByRole('switch',{name:'Status changed',exact:true}).click();
  await page.getByRole('switch',{name:'Completion times',exact:true}).click();
  await page.getByRole('switch',{name:'Completed in TV',exact:true}).click();
  await expect(check).toBeDisabled();
  await expect(page.getByText('Turn on at least one option to continue.')).toBeVisible();
  await page.getByRole('switch',{name:'Completion times',exact:true}).click();
  await expect(page.getByRole('switch',{name:'Completion times',exact:true})).toHaveAttribute('aria-checked','true');
  await expect(page.locator('.production-report-files article')).toHaveCount(2);
  await expect(page.getByText('OFF — skipped',{exact:true})).toHaveCount(6);
  expect(requests).toHaveLength(1);
  await expect(proceed).toBeEnabled();
  await page.screenshot({path:'test-results/production-export-options.png',fullPage:true});
  await proceed.click();
  await expect(page.getByText('Excel updated successfully',{exact:true})).toBeVisible();
  expect(requests.at(-1).export_options).toEqual({new_orders:false,status_changes:false,completion_times:true,completed_tv:false});
  expect(requests.at(-1).fingerprint).toBe('checked');
});

test('completion upload is included in checks and shows completion counts and details',async({page})=>{
  const fixture=workspaceFixture(3);
  let token;
  const uploads=[];
  await page.route('**/api/**',async route=>{
    const name=new URL(route.request().url()).pathname;
    let body=fixture.response(name);
    if(name==='/api/production-report')body={folder:'C:\\Reports',previews:fixture.previews,selected_preview_id:32};
    if(name.endsWith('/completion-upload')){
      const names=Array.from(route.request().postData().matchAll(/filename="([^"]+)"/g),match=>match[1]);
      uploads.push(names);
      body={token:`test-token-${uploads.length}`,names,files:names.length,orders:2,conflicts:names.length>1?2:0,
        completion_rows:[{'Order Number':'DONE-1','Completion time (IST)':'2026-11-11 06:19:29','Source files':names[0]},
          {'Order Number':'UNMATCHED-DONE'}],
        conflict_rows:names.length>1?[{'Order Number':'CONFLICT-1','Reported times (U.S. Central)':'Two different times'},
          {'Order Number':'UNMATCHED-CONFLICT'}]:[]};
      if(uploads.length===1){
        delete body.completion_rows;
        delete body.conflict_rows;
      }
    }
    if(name.endsWith('/completion-serials'))body={serials:{'done-1':'671','conflict-1':'749'}};
    if(name.endsWith('/check')){
      token=route.request().postDataJSON().completion_token;
      body={preview_name:'preview32',fingerprint:'checked',columns:['Order Number','Out Time'],rows:[],unresolved:[],reports:[{kind:'full',name:'Full Search.xlsx',sheet:'TV Orders',missing:0,existing:2,skipped:0,orders:[],completion_count:1,completion_kept:1,completion_unmatched:0,completion_orders:[{'Order Number':'DONE-1','Out Time':'2026-11-11T06:19:29'}]}]};
    }
    if(name.endsWith('/check')||name.endsWith('/proceed'))body={...body,export_options_version:1,export_options:route.request().postDataJSON().export_options,candidate_fingerprint:'stable'};
    await route.fulfill({json:body});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Production Report',exact:true}).click();
  await page.getByLabel('Production report folder',{exact:true}).fill('C:\\Reports\\Session');
  await page.getByLabel('Upload completed ExcelReport',{exact:true}).setInputFiles(['ExcelReport.xlsx','ExcelReport(2).xlsx'].map(name=>({name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('mock upload')})));
  await page.getByRole('button',{name:'orders with completion times',exact:true}).click();
  const uploaded=page.getByRole('dialog',{name:'Orders with completion times'});
  await expect(uploaded.getByRole('cell',{name:'DONE-1',exact:true})).toBeVisible();
  await expect(uploaded.getByRole('cell',{name:'671',exact:true})).toBeVisible();
  await expect(uploaded.getByRole('cell',{name:'UNMATCHED-DONE',exact:true})).toHaveCount(0);
  await uploaded.getByRole('textbox',{name:'Search by order number'}).fill('unknown');
  await expect(uploaded.getByText('No matching rows')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'1 conflicting orders excluded',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Conflicting orders excluded'}).getByRole('cell',{name:'CONFLICT-1',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog',{name:'Conflicting orders excluded'}).getByRole('cell',{name:'749',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog',{name:'Conflicting orders excluded'}).getByRole('cell',{name:'UNMATCHED-CONFLICT',exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByText('ExcelReport.xlsx',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Check folder & orders',exact:true}).click();
  await page.getByRole('button',{name:'1 Completion times to update Included View orders',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Full Search — completion times'});
  await expect(dialog.getByRole('cell',{name:'DONE-1',exact:true})).toBeVisible();
  await expect(dialog.getByRole('cell',{name:'2026-11-11T06:19:29',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('switch',{name:'Status changed',exact:true}).click();
  await page.getByRole('button',{name:'Capacity Report',exact:true}).click();
  await page.getByRole('heading',{name:'Capacity Report',exact:true}).waitFor();
  await page.getByRole('button',{name:'Production Report',exact:true}).click();
  await expect(page.getByLabel('Production report folder',{exact:true})).toHaveValue('C:\\Reports\\Session');
  await expect(page.getByLabel('Production report preview',{exact:true})).toHaveValue('32');
  await expect(page.getByText('ExcelReport.xlsx',{exact:true})).toBeVisible();
  await expect(page.getByRole('switch',{name:'Status changed',exact:true})).toHaveAttribute('aria-checked','false');
  await expect(page.getByRole('button',{name:'1 Completion times to update Included View orders',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Check folder & orders',exact:true}).click();
  await expect.poll(()=>token).toBe('test-token-2');
  await page.getByRole('button',{name:'Remove ExcelReport(2).xlsx',exact:true}).click();
  await expect(page.getByRole('button',{name:'Remove ExcelReport(2).xlsx',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'0 conflicting orders excluded',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/^Proceed/})).toBeDisabled();
  await page.getByRole('button',{name:'Check folder & orders',exact:true}).click();
  await expect.poll(()=>token).toBe('test-token-3');
  expect(uploads).toEqual([['ExcelReport.xlsx','ExcelReport(2).xlsx'],['ExcelReport.xlsx','ExcelReport(2).xlsx'],['ExcelReport.xlsx']]);
  await expect(page.getByRole('button',{name:'1 Completion times to update Included View orders',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Remove ExcelReport.xlsx',exact:true}).click();
  await expect(page.getByRole('button',{name:'Remove completion reports',exact:true})).toHaveCount(0);
  expect(uploads).toHaveLength(3);
});

test('report titles and counts open only their missing orders in a popup',async({page})=>{
  const fixture=workspaceFixture(3);
  const full={'Order Number':'FULL-NEW',Product:'Full Title',Status:'Search In Progress'};
  const co={'Order Number':'CO-NEW',Product:'ClientReview',Status:'SearchFix'};
  let completed=false,checks=0;
  await page.route('**/api/**',async route=>{
    const name=new URL(route.request().url()).pathname;
    let body=fixture.response(name);
    if(name==='/api/production-report')body={folder:'C:\\Reports',previews:fixture.previews,selected_preview_id:32};
    if(name==='/api/production-report/check'||name==='/api/production-report/proceed'){
      if(name.endsWith('check'))checks++;
      if(name.endsWith('proceed'))completed=true;
      const selections=route.request().postDataJSON()?.status_overrides||{};
      for(const row of [full,co])if(selections[row['Order Number']])row.Status=selections[row['Order Number']];
      body={preview_name:'preview32',fingerprint:'checked',columns:['Order Number','Product','Status'],rows:[full,co,{'Order Number':'ALREADY-PRESENT'}],unresolved:[],completed,downloads:[],reports:[{kind:'full',name:'Full Search.xlsx',sheet:'TV Orders',missing:1,existing:3,skipped:1,orders:[full]},{kind:'co',name:'C-O and Update.xlsx',sheet:'Sheet1',missing:1,existing:3,skipped:0,orders:[co]}]};
    }
    if(name.endsWith('/check')||name.endsWith('/proceed'))body={...body,export_options_version:1,export_options:route.request().postDataJSON().export_options,candidate_fingerprint:'stable'};
    await route.fulfill({json:body});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Production Report',exact:true}).click();
  const orderSearch=page.getByRole('region',{name:'Production Report order search'});
  await expect(page.getByLabel('Search Production Report orders',{exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Check folder & orders',exact:true}).click();
  await page.getByLabel('Search Production Report orders',{exact:true}).fill('full-new');
  await expect(orderSearch.getByRole('cell',{name:'FULL-NEW',exact:true})).toBeVisible();
  await expect(orderSearch.getByRole('cell',{name:'CO-NEW',exact:true})).toHaveCount(0);
  await expect(orderSearch.getByRole('columnheader',{name:/Destination/})).toHaveCount(0);
  await page.getByLabel('Search Production Report orders',{exact:true}).fill('not-found');
  await expect(orderSearch.getByText('No orders match this order number.')).toBeVisible();
  await page.getByRole('button',{name:'Clear Production Report order search'}).click();
  await page.getByRole('button',{name:'Full Search: 1 Newly orders',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'Full Search — Newly orders'});
  await expect(dialog).toBeVisible();
  expect((await dialog.boundingBox()).width).toBeGreaterThan(1400);
  const plannedStatus=dialog.getByRole('combobox',{name:'Planned status for FULL-NEW'});
  await expect(plannedStatus).toHaveCount(0);
  await dialog.getByRole('button',{name:'Edit planned status for FULL-NEW'}).click();
  const statusCell=plannedStatus.locator('xpath=ancestor::td[1]');
  const bounds=await statusCell.boundingBox();
  for(const name of ['Confirm planned status for FULL-NEW','Cancel status edit for FULL-NEW']){
    const button=dialog.getByRole('button',{name});
    await expect(button).toBeVisible();
    const box=await button.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x+box.width).toBeLessThanOrEqual(bounds.x+bounds.width);
  }
  await expect(plannedStatus.locator('option',{hasText:'Completed and Delivered'})).toHaveCount(1);
  await plannedStatus.selectOption('Awaiting for Clarification');
  await expect(plannedStatus).toHaveValue('Awaiting for Clarification');
  expect(checks).toBe(1);
  await dialog.getByRole('button',{name:'Cancel status edit for FULL-NEW'}).click();
  await expect(plannedStatus).toHaveCount(0);
  await expect(dialog.locator('.production-status-pill')).toHaveText('Search In Progress');
  expect(checks).toBe(1);
  await dialog.getByRole('button',{name:'Edit planned status for FULL-NEW'}).click();
  await expect(plannedStatus).toHaveValue('Search In Progress');
  await plannedStatus.selectOption('Awaiting for Clarification');
  await dialog.getByRole('button',{name:'Confirm planned status for FULL-NEW'}).click();
  await expect(plannedStatus).toHaveCount(0);
  await expect(dialog.locator('.production-status-pill')).toHaveText('Awaiting for Clarification');
  expect(checks).toBe(2);
  await expect(dialog.getByRole('cell',{name:'FULL-NEW',exact:true})).toBeVisible();
  await expect(dialog.getByRole('cell',{name:'CO-NEW',exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('cell',{name:'ALREADY-PRESENT',exact:true})).toHaveCount(0);
  await dialog.getByRole('textbox',{name:'Search report orders'}).fill('no match');
  await expect(dialog.getByText('No matching rows',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'C-O and Update',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'C-O and Update — Newly orders'});
  await expect(dialog.getByRole('cell',{name:'CO-NEW',exact:true})).toBeVisible();
  await expect(dialog.getByRole('cell',{name:'FULL-NEW',exact:true})).toHaveCount(0);
  await page.screenshot({path:'test-results/production-report-popup.png',animations:'disabled'});
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'Proceed — update selected orders',exact:true}).click();
  await page.getByRole('button',{name:'Full Search: 1 orders added',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Full Search — orders added'}).getByRole('cell',{name:'FULL-NEW',exact:true})).toBeVisible();
});


for(const multiple of [false,true]){
test(`product selection (${multiple?'multiple S.No values':'single S.No'}) keeps IST and supports undo and redo`,async({page})=>{
  const fixture=workspaceFixture(3);
  const candidate={product:'Full Title',time_central:'2026-11-11 00:22:36',time_ist:'2026-11-11 11:52:36',files:['one.xlsx']};
  const conflict={'Order Number':'CONFLICT-1',Products:'Full Title, ClientReview',candidates:[
    candidate,{product:'ClientReview',time_central:'2026-11-12 01:00:00',time_ist:'2026-11-12 12:30:00',files:['two.xlsx']}
  ]};
  let move;
  let engineOutdated=true;
  await page.route('**/api/**',async route=>{
    const name=new URL(route.request().url()).pathname;
    let body=fixture.response(name);
    if(name==='/api/production-report')body={folder:'C:\\Reports',previews:fixture.previews};
    if(name.endsWith('/completion-serials'))body={serials:{'conflict-1':multiple?'1910, 1966':'1461'}};
    if(name.endsWith('/completion-upload'))body={token:'original',names:['one.xlsx'],files:1,orders:0,conflicts:1,completion_rows:[],conflict_rows:[conflict]};
    if(name.endsWith(multiple?'/resolve-product-conflicts':'/resolve-conflicts-version')){
      if(engineOutdated)return route.fulfill({status:404,json:{error:'Unknown action'}});
      move=route.request().postDataJSON();
      body={token:'updated',orders:1,conflicts:0,completion_rows:[{'Order Number':'CONFLICT-1','Completion time (IST)':candidate.time_ist}],conflict_rows:[]};
    }
    await route.fulfill({json:body});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Production Report',exact:true}).click();
  await page.getByLabel('Upload completed ExcelReport').setInputFiles({name:'one.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('mock upload')});
  await page.getByRole('button',{name:'1 conflicting orders excluded',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Conflicting orders excluded'});
  const row=dialog.getByRole('row').filter({hasText:'CONFLICT-1'});
  await expect(row.getByRole('checkbox')).toHaveCount(0);
  const product=row.getByRole('button',{name:'Full Title',exact:true});
  const picker=dialog.getByText('Select products',{exact:true});
  await picker.click();
  await dialog.getByRole('checkbox',{name:'Full Title',exact:true}).check();
  await dialog.getByRole('button',{name:'Apply (1)',exact:true}).click();
  await expect(product).toHaveAttribute('aria-pressed','true');
  await picker.click();
  await expect(dialog.getByRole('checkbox',{name:'Full Title',exact:true})).toBeChecked();
  await dialog.getByRole('checkbox',{name:'Full Title',exact:true}).uncheck();
  await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(product).toHaveAttribute('aria-pressed','false');
  await product.click();
  await expect(product).toHaveAttribute('aria-pressed','true');
  await expect(row.getByText(candidate.time_ist,{exact:!multiple})).toBeVisible();
  await row.getByRole('button',{name:'Edit Indian date and time'}).click();
  const timeFields=row.getByRole('group',{name:'Indian completion time'});
  for(const heading of ['HH','MM','SS'])await expect(timeFields.getByText(heading,{exact:true})).toBeVisible();
  await timeFields.getByLabel('Seconds').selectOption('42');
  await row.getByRole('button',{name:'Confirm date and time'}).click();
  await expect(row.getByText('2026-11-11 11:52:42',{exact:!multiple})).toBeVisible();
  const second=row.getByRole('button',{name:'ClientReview',exact:true});
  await second.click();
  await expect(product).toHaveAttribute('aria-pressed',String(multiple));
  await expect(second).toHaveAttribute('aria-pressed','true');
  if(!multiple)await product.click();
  await expect(row.getByRole('cell',{name:'CONFLICT-1',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Move Selected to Completed (1)',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Restart it from the updated workspace');
  await expect(product).toHaveAttribute('aria-pressed','true');
  await expect(dialog.getByRole('button',{name:'Undo',exact:true})).toBeDisabled();
  engineOutdated=false;
  await row.getByRole('button',{name:'Move to Completed',exact:true}).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button',{name:'0 conflicting orders excluded',exact:true}).click();
  await expect(dialog.getByText('No conflicting orders in this upload.')).toBeVisible();
  const resolutions=[{order_number:'CONFLICT-1',time_ist:multiple?'2026-11-11 11:52:42':candidate.time_ist,source_file:'one.xlsx',time_central:candidate.time_central}];
  if(multiple){
    resolutions[0].product='Full Title';
    resolutions.push({order_number:'CONFLICT-1',product:'ClientReview',time_ist:'2026-11-12 12:30:00',
      source_file:'two.xlsx',time_central:'2026-11-12 01:00:00'});
  }
  expect(move).toEqual({token:'original',resolutions});
  await dialog.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(row).toBeVisible();
  await dialog.getByRole('button',{name:'Redo',exact:true}).click();
  await expect(dialog.getByText('No conflicting orders in this upload.')).toBeVisible();
});
}
