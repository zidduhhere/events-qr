import {test,expect} from '@playwright/test'
const session={id:'11111111-1111-4111-8111-111111111111',name:'Day 1 · Lunch',meal_type:'lunch',status:'open',per_person_limit:1}
test.beforeEach(async({page})=>{await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;const data=path==='/api/health'?{connected:true}:path==='/api/sessions'?[session]:path==='/api/dashboard'?{participants:0,guests:0,served:0,lunch:0,dinner:0,platinum:0,silver:0,sessions:[session],recent:[]}:path==='/api/printing'?{width_mm:50,height_mm:40}:[];await route.fulfill({json:data})})})
for(const [path,title] of [['/','A good meal starts with a smooth entry.'],['/participants','Participants'],['/scan','Dining scanner'],['/settings','Event settings'],['/reports','Reports & history']])test(`${path} opens directly`,async({page})=>{await page.goto(path);await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/log in|sign in/i})).toHaveCount(0)})
test('connection failure blocks approval and retry preserves request ID',async({page})=>{const requests:string[]=[];await page.route('**/api/redemptions',async route=>{requests.push(route.request().postDataJSON().requestId);await route.abort('failed')});await page.goto('/scan');await page.getByLabel('ACTIVE MEAL SESSION').selectOption(session.id);await page.getByText('Keyboard scanner or manual entry',{exact:true}).click();await page.getByLabel('QR token').fill('evt_test');await page.getByLabel('QR token').press('Enter');await expect(page.getByRole('heading',{name:'Entry not confirmed'})).toBeVisible();await expect(page.getByLabel('QR token')).toBeDisabled();await page.getByRole('button',{name:'Retry same scan'}).click();await expect.poll(()=>requests.length).toBe(2);expect(requests[0]).toBe(requests[1]);await expect(page.getByRole('heading',{name:'Entry approved',exact:true})).toHaveCount(0);await page.reload();await page.getByRole('button',{name:'Recover saved scan'}).click();await expect.poll(()=>requests.length).toBe(3);expect(requests[2]).toBe(requests[0])})

test('handheld scanner submits while a button has focus',async({page})=>{
 await page.route('**/api/redemptions',async route=>{const input=route.request().postDataJSON();await route.fulfill({json:{requestId:input.requestId,approved:false,reason:'QR code not recognized',redemptionId:null,participant:null,timestamp:new Date().toISOString()}})})
 await page.goto('/scan');await page.getByLabel('ACTIVE MEAL SESSION').selectOption(session.id)
 await page.getByRole('button',{name:'Start Camera',exact:true}).focus()
 await page.keyboard.type('evt_handheld');await page.keyboard.press('Enter')
 await expect(page.getByRole('heading',{name:'Entry denied',exact:true})).toBeVisible()
})

for(const approved of [true,false])test(`${approved?'approval':'denial'} popup closes after one second`,async({page})=>{
 await page.clock.install()
 await page.route('**/api/redemptions',async route=>{const input=route.request().postDataJSON();await route.fulfill({json:{requestId:input.requestId,approved,reason:approved?'Entry approved':'This meal is not included in the registration',redemptionId:approved?'redemption-test':null,participant:{id:'person-test',name:'Gate Test',pass:'Silver',remaining:{lunch:1,dinner:1,total:2}},timestamp:new Date().toISOString()}})})
 await page.goto('/scan');await page.getByLabel('ACTIVE MEAL SESSION').selectOption(session.id)
 await page.getByText('Keyboard scanner or manual entry',{exact:true}).click();await page.getByLabel('QR token').fill('evt_popup_test');await page.getByLabel('QR token').press('Enter')
 await expect(page.getByRole('alertdialog')).toBeVisible()
 await page.clock.runFor(1100)
 await expect(page.getByRole('alertdialog')).toHaveCount(0)
 await expect(page.getByText('Gate Test',{exact:true})).toBeVisible()
})
