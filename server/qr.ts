import QRCode from 'qrcode'
import type { Connection, Database } from './db.ts'
import { HttpError, csvCell } from './validation.ts'
import { audit } from './operations.ts'
type QRParticipant={id:string;name:string;registration_number:string|null;category:string|null;parent_id:string|null;qr_token:string;pass_name:string}
export async function ensureQrImage(db:Pick<Connection,'query'>,id:string):Promise<Buffer>{
 const existing=(await db.query<{png:Uint8Array}>('SELECT png FROM participant_qr_images WHERE participant_id=$1',[id])).rows[0]
 if(existing)return Buffer.from(existing.png)
 const p=(await db.query<{qr_token:string}>('SELECT qr_token FROM participants WHERE id=$1',[id])).rows[0]
 if(!p)throw new HttpError(404,'Participant not found.')
 const png=await QRCode.toBuffer(p.qr_token,{type:'png',errorCorrectionLevel:'M',margin:4,scale:24,color:{dark:'#000000',light:'#ffffff'}})
 await db.query('INSERT INTO participant_qr_images(participant_id,png) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,png])
 return png
}
function slug(s:string){return s.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64)||'participant'}
export function qrFilename(p:{id:string;name:string;registration_number?:string|null}){return `${slug(p.registration_number??'participant')}__${slug(p.name)}__${p.id}.png`}
// Standard ZIP, stored entries. PNG is already compressed, so recompression is unnecessary.
function crc32(bytes:Buffer){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
export function zipFiles(files:{name:string;data:Buffer}[]):Buffer{
 const chunks:Buffer[]=[];const directory:Buffer[]=[];let offset=0;let size=0
 if(files.length>65535)throw new HttpError(413,'Too many files for one ZIP export.')
 for(const file of files){const name=Buffer.from(file.name,'utf8');const crc=crc32(file.data);const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(file.data.length,18);local.writeUInt32LE(file.data.length,22);local.writeUInt16LE(name.length,26)
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(file.data.length,20);central.writeUInt32LE(file.data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42)
  chunks.push(local,name,file.data);directory.push(central,name);offset+=local.length+name.length+file.data.length;size+=central.length+name.length
  if(offset+size>0xffffffff)throw new HttpError(413,'ZIP export exceeds the supported size.')
 }
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16)
 return Buffer.concat([...chunks,...directory,end])
}
export async function exportQrZip(db:Database,label=''){
 const people=(await db.query<QRParticipant>('SELECT p.*,ps.name AS pass_name FROM participants p JOIN passes ps ON ps.id=p.pass_id ORDER BY COALESCE(p.registration_number,p.id),p.id')).rows
 if(!people.length)throw new HttpError(400,'No participants to export. Register or import participants first.')
 const files:{name:string;data:Buffer}[]=[]
 const mapping:unknown[][]=[['Registration number','Name','Category','Pass','Participant ID','Parent participant ID','QR image filename']]
 for(const p of people){const name='qr-codes/'+qrFilename(p);files.push({name,data:await ensureQrImage(db,p.id)});mapping.push([p.registration_number??'',p.name,p.category??'',p.pass_name,p.id,p.parent_id??'',name])}
 files.push({name:'participants.csv',data:Buffer.from('\uFEFF'+mapping.map(row=>row.map(csvCell).join(',')).join('\r\n'),'utf8')})
 files.push({name:'PRINTING-README.txt',data:Buffer.from(`TABLEPASS ID CARD QR PACK\nParticipants: ${people.length}\n\nEach PNG maps to exactly one person in participants.csv. Registration numbers and participant IDs distinguish repeated names.\nPNG images are lossless black-on-white with a four-module quiet zone. Keep them square and retain the white border. Use a QR size of at least 25 mm as a starting point; test an actual printed card before the print run.\nThe images contain opaque tokens only. They work with this event database and do not require reprinting when meal allowances change. Do not regenerate participant records or replace their tokens after printing.\nThis pack contains live admission codes. Share it only with your event printing team. An export is not evidence of physical printing.\n`)})
 const zip=zipFiles(files)
 await audit(db,'qr.bulk_exported','all',label,{participants:people.length,files:files.length,note:'QR artwork export; physical printing unverified.'})
 return {zip,count:people.length}
}
