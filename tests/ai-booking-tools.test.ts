import assert from "node:assert/strict";
import test from "node:test";
import { createFrontOfficeBookingTools } from "../src/services/ai/front-office-booking.service.js";
import type { FrontOfficeBrandAdapter, FrontOfficeTenantContext, FrontOfficeBookingInput } from "../src/services/ai/brand-adapter.js";

function fixture() {
  let now=new Date("2026-10-13T00:00:00Z");
  const context:FrontOfficeTenantContext={did:"+61400000000",tenantId:"tenant-a",ownerId:"owner-a",branchId:"branch-a",branchName:"A",workshopName:"Workshop A"};
  let contractReady=true;
  const writes:FrontOfficeBookingInput[]=[];
  const adapter:FrontOfficeBrandAdapter={brand:"black",getBranch:async()=>({}),listServices:async()=>[{id:"service-a",name:"Service A"}],
    getAvailableSlots:async(_context,query)=>({date:query.date,timeZone:"Australia/Sydney",availableSlots:["09:00","14:00"],dailyLimitReached:false,bookingContractReady:contractReady}),
    createBooking:async(_context,input)=>{writes.push(input);return {status:"PENDING_REVIEW",bookingId:"booking-a",bookingCode:"CC-A",upstreamStatus:"Pending",message:"Submitted for staff approval."};}};
  const tools=createFrontOfficeBookingTools(adapter,async()=>context,()=>now,()=>true);
  return {adapter,tools,context,writes,advance:()=>{now=new Date(now.getTime()+11*60000);},oldContract:()=>{contractReady=false;},now:()=>now};
}
const query={date:"2026-10-14",serviceIds:["service-a"]};
const contact={customerConfirmed:true,customerName:"Test Customer",customerEmail:"test@example.invalid",customerPhone:"+61400000000"};
async function token(f:ReturnType<typeof fixture>) {return (await f.tools.getAvailableSlots(query)).slots[0]!.slotToken;}

test("uses branch timezone and removes past drop-off times",async()=>{
  const f=fixture();const result=await f.tools.getAvailableSlots({...query,date:"2026-10-13"});
  assert.deepEqual(result.slots.map(slot=>slot.time),["14:00"]);
  assert.equal(result.slotType,"DROP_OFF");assert.equal(result.bookingWorkflow,"WORKSHOP_PERMISSION");
});
test("rejects impossible dates and another branch's service",async()=>{
  const f=fixture();
  await assert.rejects(f.tools.getAvailableSlots({...query,date:"2026-02-30"}));
  await assert.rejects(f.tools.getAvailableSlots({...query,serviceIds:["other-service"]}));assert.equal(f.writes.length,0);
});
test("requires explicit confirmation and all customer contact details",async()=>{
  const f=fixture();const slotToken=await token(f);
  await assert.rejects(f.tools.createBooking({...contact,slotToken,customerConfirmed:false}));
  await assert.rejects(f.tools.createBooking({...contact,slotToken,customerEmail:""}));assert.equal(f.writes.length,0);
});
test("rejects offers from another session, a remapped tenant, and expired offers",async()=>{
  const f=fixture();const slotToken=await token(f);
  const other=createFrontOfficeBookingTools(f.adapter,async()=>f.context,f.now,()=>true);
  assert.equal((await other.createBooking({...contact,slotToken})).status,"INVALID_SLOT");
  f.context.ownerId="owner-b";
  // The resolver returns a new mapping object in production; simulate that here.
  const remapped=createFrontOfficeBookingTools(f.adapter,async()=>({...f.context}),f.now,()=>true);
  const mapped=await remapped.getAvailableSlots(query);
  f.context.ownerId="owner-c";
  assert.equal((await remapped.createBooking({...contact,slotToken:mapped.slots[0]!.slotToken})).status,"INVALID_SLOT");
  f.context.ownerId="owner-a";
  f.advance();assert.equal((await f.tools.createBooking({...contact,slotToken})).status,"EXPIRED_SLOT");assert.equal(f.writes.length,0);
});
test("cannot write to an old Black API or while the booking flag is disabled",async()=>{
  const f=fixture();const slotToken=await token(f);f.oldContract();
  assert.equal((await f.tools.createBooking({...contact,slotToken})).status,"REJECTED");
  const disabled=createFrontOfficeBookingTools(f.adapter,async()=>f.context,f.now,()=>false);
  assert.equal((await disabled.createBooking({...contact,slotToken})).status,"DISABLED");assert.equal(f.writes.length,0);
});
test("parallel and repeated identical calls submit only once and never claim confirmation",async()=>{
  const f=fixture();const slotToken=await token(f);
  const results=await Promise.all([f.tools.createBooking({...contact,slotToken}),f.tools.createBooking({...contact,slotToken})]);
  assert.ok(results.every(result=>result.status==="PENDING_REVIEW"));
  await f.tools.createBooking({...contact,slotToken});assert.equal(f.writes.length,1);
  assert.equal((await f.tools.createBooking({...contact,slotToken,customerName:"Changed name"})).status,"CONFLICT");
});
test("untrusted tenant, service and time arguments cannot change the selected offer",async()=>{
  const f=fixture();const slotToken=await token(f);
  await f.tools.createBooking({...contact,slotToken,ownerUid:"owner-b",branchId:"branch-b",serviceIds:["other"],time:"23:00"});
  assert.equal(f.writes[0]!.time,"09:00");assert.deepEqual(f.writes[0]!.serviceIds,["service-a"]);
});
test("a timeout retries with the same idempotency key, without reporting success",async()=>{
  const f=fixture();const slotToken=await token(f);
  f.adapter.createBooking=async(_context,input)=>{f.writes.push(input);return {status:"UNKNOWN",message:"Unknown result."};};
  assert.equal((await f.tools.createBooking({...contact,slotToken})).status,"UNKNOWN");
  await f.tools.createBooking({...contact,slotToken});assert.equal(f.writes[0]!.idempotencyKey,f.writes[1]!.idempotencyKey);
});
