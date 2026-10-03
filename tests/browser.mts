import {PGlite} from "@electric-sql/pglite";
import {PGLiteSocketServer} from "@electric-sql/pglite-socket";
import {chromium} from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
const output=path.resolve("test-results");await fs.mkdir(output,{recursive:true});
const pg=await PGlite.create();await pg.exec(await fs.readFile("migrations/000_initial_schema.sql","utf8"));await pg.exec(await fs.readFile("migrations/001_secure_intake.sql","utf8"));await pg.exec(await fs.readFile("migrations/002_hierarchy.sql","utf8"));await pg.exec("ALTER TABLE users ALTER COLUMN must_change_password SET DEFAULT false");
const socket=new PGLiteSocketServer({db:pg,port:5549,host:"127.0.0.1",maxConnections:20});await socket.start();
process.env.DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5549/postgres";process.env.NODE_ENV="test";process.env.APP_ORIGIN="http://127.0.0.1:5098";process.env.STATIC_DIR=path.resolve("artifacts/orbitdesk/dist/public");
const {hashPassword}=await import("../artifacts/orbitdesk/server/lib/security.ts");const {pool}=await import("../lib/db/src/index.ts");const {default:app}=await import("../artifacts/orbitdesk/server/app.ts");
const password=randomBytes(20).toString("base64url");await pool.query("INSERT INTO users(id,name,email,password_hash,role) VALUES(1,'Workspace Admin','admin@example.test',$1,'super_admin')",[await hashPassword(password)]);
await pool.query("INSERT INTO departments(id,name) VALUES(1,'Human Resources'),(2,'BGV'),(3,'IT')");
await pool.query("INSERT INTO users(id,name,email,password_hash,role,department_id,must_change_password) VALUES(2,'Test Manager','manager@example.test',$1,'manager',1,false),(3,'Test Employee','employee@example.test',$1,'employee',1,true)",[await hashPassword(password)]);
for(let i=0;i<12;i++){const bgv=i%3===0;const type=bgv?"bgv-request":"employment-verification";const statuses=["open","in_progress","waiting","resolved"];await pool.query("INSERT INTO tickets(ticket_number,subject,description,status,priority,created_by_id,tags,department_id,raised_for_name,created_at,sla_deadline) VALUES($1,$2,$3,$4,'medium',1,$5,$6,$7,now()-($8*interval '1 day'),now()+($9*interval '1 hour'))",[`DJ-TEST-${String(i+1).padStart(4,'0')}`,`${bgv?"Background":"Employment"} verification — Test candidate ${i+1}`,"Synthetic review request. No real employee data.",statuses[i%4],[type,...(i<8?["business-website"]:[])],bgv?2:1,`Test candidate ${i+1}`,i%7,i%3===0?-2:24]);}
const server=app.listen(5098,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,args:["--no-sandbox"]});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});const page=await context.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));let checks=0;
try{
 await page.goto("http://127.0.0.1:5098/");await page.getByRole("heading",{name:"Welcome back."}).waitFor();checks++;
 await page.screenshot({path:path.join(output,"orbitdesk-login.png")});
 await page.getByLabel("Work email").fill("admin@example.test");await page.getByLabel("Password",{exact:true}).fill(password);await page.getByRole("button",{name:"Enter workspace"}).click();await page.getByRole("heading",{name:"A clear view. A better day."}).waitFor();
 assert.equal(await page.locator(".metric-card strong").first().innerText(),"9");checks++;
 await page.screenshot({path:path.join(output,"orbitdesk-dashboard.png")});
 await page.goto("http://127.0.0.1:5098/employment-verification");await page.getByText("8 matching requests").waitFor();checks++;
 assert.equal(await page.locator("tbody tr").count(),8);checks++;
 await page.getByLabel("Search verification requests").fill("TEST-0002");await page.getByText("1 matching requests").waitFor();checks++;
 await page.getByLabel("Filter by status").selectOption("resolved");await page.getByText("0 matching requests").waitFor();checks++;
 await page.getByLabel("Search verification requests").fill("");await page.getByLabel("Filter by status").selectOption("");await page.getByText("8 matching requests").waitFor();
 await page.getByRole("link",{name:"Open DJ-TEST-0002",exact:true}).click();await page.getByText("Synthetic review request. No real employee data.").waitFor();checks++;
 await page.goto("http://127.0.0.1:5098/background-verification");await page.getByText("4 matching requests").waitFor();await page.screenshot({path:path.join(output,"orbitdesk-bgv.png")});checks++;
 await page.goto("http://127.0.0.1:5098/integrations");await page.getByText("Setup required",{exact:true}).waitFor();checks++;
 await page.goto("http://127.0.0.1:5098/tickets/new?queue=bgv-request");await page.getByRole("heading",{name:/Create|New/}).first().waitFor();checks++;
 await page.goto("http://127.0.0.1:5098/users");await page.getByRole("heading",{name:"The right people. Connected."}).waitFor();await page.getByRole("button",{name:"Manage Test Employee"}).click();await page.getByLabel("Reporting manager").selectOption("2");await page.getByLabel("Team name").fill("Verification support");await page.getByRole("button",{name:"Save changes",exact:true}).click();await page.getByRole("status").filter({hasText:"User access"}).waitFor();assert.equal((await pool.query("SELECT manager_id FROM users WHERE id=3")).rows[0].manager_id,2);checks++;
 await page.screenshot({path:path.join(output,"orbitdesk-people.png")});
 const employeeContext=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:"reduce"});const employeePage=await employeeContext.newPage();employeePage.on("pageerror",e=>errors.push(e.message));await employeePage.goto("http://127.0.0.1:5098/");await employeePage.getByLabel("Work email").fill("employee@example.test");await employeePage.getByLabel("Password",{exact:true}).fill(password);await employeePage.getByRole("button",{name:"Enter workspace"}).click();await employeePage.getByRole("heading",{name:"Make this account yours."}).waitFor();checks++;
 await employeePage.goto("http://127.0.0.1:5098/dashboard");await employeePage.getByRole("heading",{name:"Make this account yours."}).waitFor();checks++;
 await employeePage.screenshot({path:path.join(output,"orbitdesk-first-login.png")});
 await employeePage.getByLabel("Current password",{exact:true}).fill(password);await employeePage.getByLabel("New password",{exact:true}).fill(password+"updated");await employeePage.getByLabel("Confirm new password",{exact:true}).fill(password+"updated");await employeePage.getByRole("button",{name:"Save new password"}).click();await employeePage.getByRole("heading",{name:"You’re all set."}).waitFor();checks++;await employeePage.getByRole("button",{name:"Sign in with new password"}).click();await employeePage.getByLabel("Work email").fill("employee@example.test");await employeePage.getByLabel("Password",{exact:true}).fill(password+"updated");await employeePage.getByRole("button",{name:"Enter workspace"}).click();await employeePage.getByRole("heading",{name:"A clear view. A better day."}).waitFor();checks++;await employeeContext.close();
 // Data errors are explicit and do not masquerade as empty queues.
 await page.route("**/api/tickets?**",route=>route.fulfill({status:503,contentType:"application/json",body:'{"error":"Test outage"}'}));
 await page.goto("http://127.0.0.1:5098/background-verification");await page.getByRole("alert").filter({hasText:"Unable to load"}).waitFor();checks++;await page.unroute("**/api/tickets?**");
 for(const url of ["/dashboard","/employment-verification","/background-verification","/integrations"]){await page.setViewportSize({width:390,height:844});await page.goto("http://127.0.0.1:5098"+url);await page.locator(".workspace-heading h1").waitFor();const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,items:[...document.querySelectorAll("body *")].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right}))}));if(overflow.scroll>overflow.width+1){console.log(overflow);await page.screenshot({path:path.join(output,"overflow.png")});}assert.ok(overflow.scroll<=overflow.width+1,url+" has overflow");checks++;}
 await page.goto("http://127.0.0.1:5098/dashboard");await page.locator(".metric-card strong").first().waitFor();await page.screenshot({path:path.join(output,"orbitdesk-mobile.png")});
 await page.getByRole("button",{name:"Open navigation",exact:true}).click();await page.locator("aside").first().getByRole("link",{name:"Background Verification",exact:true}).click();await page.getByText("4 matching requests").waitFor();checks++;
 assert.deepEqual(errors,[]);checks++;
 console.log(`${checks} browser checks passed. Synthetic data only. No page errors.`);await fs.writeFile(path.join(output,"browser-results.json"),JSON.stringify({checks,errors},null,2));
}finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));await pool.end();await socket.stop();await pg.close();}
