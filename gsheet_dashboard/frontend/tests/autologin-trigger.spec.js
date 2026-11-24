import {test,expect} from '@playwright/test';
import {workspaceFixture} from './workspace-fixture.js';

test.use({timezoneId:'America/Los_Angeles'});
test('IST clock, save activation, pause/resume and responsive trigger',async({page})=>{
  const fixture=workspaceFixture(3);
  let schedule={enabled:false,times:['14:00'],last_triggered_date:'2026-09-30',triggered_today:[]};
  const writes=[];
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/sync-schedule'){
      const body=route.request().postDataJSON();writes.push(body);schedule={...schedule,...body};
      return route.fulfill({json:schedule});
    }
    const result=fixture.response(path);
    return route.fulfill({json:path==='/api/state'?{...result,schedule,
      clock:{synchronized:true,epoch_ms:Date.parse('2026-09-30T07:31:00Z')}}:result});
  });
  await page.goto('http://127.0.0.1:8525');
  await page.locator('.sync-schedule summary').click();
  await expect(page.locator('.sync-schedule summary')).toContainText('AutoLogin Trigger');
  await expect(page.getByTestId('indian-clock')).toContainText(/01:01:\d{2} pm IST/i);
  const timeFields=page.getByRole('group',{name:'New trigger time'});
  for(const heading of ['HH','MM','SS'])await expect(timeFields.getByText(heading,{exact:true})).toBeVisible();
  await timeFields.getByLabel('Hours').selectOption('15');
  await timeFields.getByLabel('Seconds').selectOption('25');
  await page.getByRole('button',{name:'Add',exact:true}).click();
  await page.getByRole('button',{name:'Save AutoLogin Trigger',exact:true}).click();
  await expect(page.getByTestId('next-trigger')).toContainText(/02:00:00 pm IST/i);
  expect(writes[0]).toMatchObject({enabled:true,times:['14:00','15:00:25']});
  await page.getByRole('button',{name:'Pause schedule',exact:true}).click();
  await expect(page.getByTestId('next-trigger')).toHaveText('Schedule paused');
  await page.getByRole('button',{name:'Resume schedule',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pause schedule',exact:true})).toBeVisible();
  expect(writes.at(-1)).toMatchObject({enabled:true,times:['14:00','15:00:25']});
  await page.screenshot({path:'test-results/autologin-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  const panel=page.locator('.sync-schedule>div');
  await expect(panel).toBeVisible();
  const bounds=await panel.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:'test-results/autologin-mobile.png'});
});
