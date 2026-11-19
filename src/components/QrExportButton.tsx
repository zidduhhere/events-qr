import { useState } from 'react'
import Icon from './Icon'
import { deviceLabel } from '../lib/device'
import { errorMessage } from '../lib/api'
export default function QrExportButton(){
 const [busy,setBusy]=useState(false);const [error,setError]=useState('')
 async function download(){setBusy(true);setError('');try{
  const response=await fetch('/api/qr-export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceLabel:deviceLabel()})})
  if(!response.ok){const data=await response.json();throw new Error(data.error??'QR export failed.')}
  if(!response.headers.get('content-type')?.includes('application/zip'))throw new Error('The server did not return a ZIP file.')
  const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='tablepass-id-card-qr-codes.zip';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)
 }catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
 return <div className="export-control"><button className="button" disabled={busy} onClick={()=>void download()}><Icon name="download" size={17}/>{busy?'Preparing QR images…':'Download all QR codes (ZIP)'}</button>{error&&<span role="alert">{error}</span>}</div>
}
