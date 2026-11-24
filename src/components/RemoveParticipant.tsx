import {useState} from 'react'
import type {Participant} from '../../shared/types'
import {api,errorMessage} from '../lib/api'
import {deviceLabel} from '../lib/device'
import Icon from './Icon'
export default function RemoveParticipant({participant,onClose}:{participant:Participant;onClose:()=>void}){
 const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('')
 async function remove(e:React.SubmitEvent<HTMLFormElement>){e.preventDefault();if(busy)return;setBusy(true);setError('');try{await api('/participants/'+participant.id,{method:'DELETE',body:{reason,deviceLabel:deviceLabel()}});window.location.href='/participants'}catch(e){setError(errorMessage(e));setBusy(false)}}
 return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="remove-participant-title"><div className="modal-heading"><h2 id="remove-participant-title">Remove participant?</h2><button className="icon-button" aria-label="Close" disabled={busy} onClick={onClose}><Icon name="close"/></button></div><p className="muted"><strong>{participant.name}</strong> will be removed from active registrations and their QR will stop admitting them. Attendance and audit history remain available. Linked guests remain registered as independent participants.</p><form onSubmit={e=>void remove(e)}><label>Reason<textarea required maxLength={500} rows={3} autoFocus placeholder="Why is this registration being removed?" value={reason} onChange={e=>setReason(e.target.value)}/></label>{error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button danger" disabled={busy||!reason.trim()}>{busy?'Removing…':'Remove participant'}</button></div></form></section></div>
}
