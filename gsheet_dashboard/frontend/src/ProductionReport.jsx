import React,{useEffect,useMemo,useRef,useState} from 'react';
import {api} from './workspaceUtils';
import {Dialog} from './DesktopExperience';
import {Search,CheckCircle2,Undo2,Redo2,Pencil,Check,X,AlertTriangle,Upload,FileSpreadsheet,CalendarDays} from 'lucide-react';
import {DataTable} from './WorkspaceViews';
import ReportOrderSearch from './ReportOrderSearch';
import TimeFields from './TimeFields';
import {ConflictProductPicker,conflictProductChoices,selectConflictProducts,selectedConflictProducts} from './conflictProductSelection';
import './productionReport.css';
const statusChoices=['Assign to ABS','Attorney Approval','Awaiting for Clarification','Cancelled','Completed and Delivered','Home Builders','Need To Add Subscription','Need to assign ABS','QC in Progress','Responded','Search In Progress','SearchFix','Site Down','Typing in Progress','Waiting for Effective Date'];

function SuccessNotice({title,children}) {
  return <div className="production-success" role="status"><span className="production-success-icon" aria-hidden="true">✅</span><div className="production-success-content"><strong>{title}</strong>{children}</div></div>;
}

export function centralToIst(str) {
  if (!str) return '';
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return str;
  try {
    const [_, y, mo, d, h, mi, s] = m;
    const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false
    });
    const parts = {};
    for (const p of fmt.formatToParts(date)) {
      if (p.type !== 'literal') parts[p.type] = parseInt(p.value, 10);
    }
    const chicagoDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second));
    const diff = date.getTime() - chicagoDate.getTime();
    const actualUtc = new Date(date.getTime() + diff);

    const istFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });
    const istParts = {};
    for (const p of istFmt.formatToParts(actualUtc)) {
      if (p.type !== 'literal') istParts[p.type] = p.value;
    }
    return `${istParts.year}-${istParts.month}-${istParts.day} ${istParts.hour}:${istParts.minute}:${istParts.second}`;
  } catch {
    return str;
  }
}

function parseConflictCandidates(row) {
  if (Array.isArray(row?.candidates) && row.candidates.length) {
    return row.candidates;
  }
  const raw = String(row?.['Reported times (U.S. Central)'] || '');
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.map(line => {
    const match = line.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})\s*(?:\(([^)]+)\))?/);
    const time_central = match ? match[1] : line;
    const files_str = match && match[2] ? match[2] : '';
    return {
      time_central,
      time_ist: centralToIst(time_central),
      files_str,
      display: line
    };
  });
}

// Keep uploaded tokens and report work in the owning workspace for navigation.
function useSessionState(session,key,initial) {
  const [value,setValue]=useState(()=>Object.hasOwn(session.current,key)?session.current[key]:initial);
  function update(next) {
    const previous=Object.hasOwn(session.current,key)?session.current[key]:initial;
    const value=typeof next==='function'?next(previous):next;
    session.current[key]=value;
    setValue(value);
  }
  return [value,update];
}

export default function ProductionReport({revision,session,onImportsUpdated}) {
  const localSession=useRef({});
  const reportSession=session||localSession;
  const [folder,setFolder]=useSessionState(reportSession,'folder',''),[previews,setPreviews]=useState([]),[preview,setPreview]=useSessionState(reportSession,'preview','');
  const [detail,setDetail]=useState(null),[detailSearch,setDetailSearch]=useState('');
  const [restore,setRestore]=useSessionState(reportSession,'restore',null),[confirmRevert,setConfirmRevert]=useState(false),[message,setMessage]=useSessionState(reportSession,'message','');
  const [statusOverrides,setStatusOverrides]=useSessionState(reportSession,'statusOverrides',{}),[customOrder,setCustomOrder]=useState(null),[customStatus,setCustomStatus]=useState('');
  const [editingStatus,setEditingStatus]=useState(null),[statusDraft,setStatusDraft]=useState('');
  const [completionUpload,setCompletionUpload]=useSessionState(reportSession,'completionUpload',null);
  const [uploadDetails,setUploadDetails]=useState(null),[uploadSearch,setUploadSearch]=useState('');
  const [conflictFilter,setConflictFilter]=useState('all');
  const [conflictHistory,setConflictHistory]=useSessionState(reportSession,'conflictHistory',{undo:[],redo:[]});
  const [selectedTimes,setSelectedTimes]=useState({});
  const [editingIstOrder,setEditingIstOrder]=useState(null);
  const [draftDate,setDraftDate]=useState('');
  const [draftTime,setDraftTime]=useState('');
  const [conflictNotice,setConflictNotice]=useState('');
  const [uploadDetailsError,setUploadDetailsError]=useState('');
  const [serialLookup,setSerialLookup]=useState(null);
  const [completionDragging,setCompletionDragging]=useState(false);
  const [exportOptions,setExportOptions]=useSessionState(reportSession,'exportOptions',{new_orders:true,status_changes:true,completion_times:true,completed_tv:true});
  const anyExport=Object.values(exportOptions).some(Boolean);
  function verifyOptions(data){
    if(data.export_options_version!==1||!data.export_options||Object.keys(exportOptions).some(key=>data.export_options[key]!==exportOptions[key]))
      throw Error('The running app server has not confirmed these export options. Restart the app to load the export update, then Check again. No export was started.');
  }
  async function uploadCompletion(selected,{refreshDetails=false}={}){
    const files=Array.from(selected||[]);
    if(!files.length||busy)return;
    if(files.length>30||files.some(file=>!file.name.toLowerCase().endsWith('.xlsx'))){setError('Choose between 1 and 30 ExcelReport .xlsx files.');return;}
    setBusy(true);setError('');
    try{
      const form=new FormData();files.forEach(file=>form.append('files',file));
      const data=await api('/api/production-report/completion-upload',{method:'POST',body:form,timeoutMs:180000});
      if(refreshDetails&&(data.completion_rows?.length!==data.orders||data.conflict_rows?.length!==data.conflicts)){
        throw Error('The running server returned counts only. Restart TV Tracker with the updated server, then upload the ExcelReports again.');
      }
      setCompletionUpload({...data,localFiles:files});resetConflictState();invalidateCompletion();
    }catch(error){
      if(refreshDetails)setUploadDetailsError(error.message);
      else setError(error.message);
    }finally{setBusy(false);}
  }
  function removeCompletion(index){
    if(busy)return;
    const remaining=completionUpload.localFiles.filter((_,fileIndex)=>fileIndex!==index);
    if(remaining.length)uploadCompletion(remaining);
    else clearCompletion();
  }
  function clearCompletion(){
    setCompletionUpload(null);resetConflictState();setError('');invalidateCompletion();
  }
  function resetConflictState(){
    setConflictHistory({undo:[],redo:[]});
    setSelectedTimes({});
    setConflictFilter('all');
    cancelDraftIst();
    setConflictNotice('');
  }
  const [routes,setRoutes]=useSessionState(reportSession,'routes',{}),[result,setResult]=useSessionState(reportSession,'result',null),[busy,setBusy]=useState(false),[error,setError]=useSessionState(reportSession,'error','');
  useEffect(()=>{let alive=true;api('/api/production-report').then(data=>{if(alive){setFolder(value=>value||data.folder);setPreviews(data.previews);setRestore(data.revert||null);setPreview(value=>value||String(data.selected_preview_id||data.previews[0]?.id||''));}}).catch(error=>{if(alive)setError(error.message);});return()=>{alive=false;};},[revision]);
  async function run(action){
    setBusy(true);setError('');setMessage('');setDetail(null);setDetailSearch('');
    try{
      const request={folder,preview_id:Number(preview),routes,status_overrides:statusOverrides,fingerprint:result?.fingerprint,token:restore?.token,export_options:exportOptions,completion_token:completionUpload?.token};
      if(action==='proceed'){
        const checked=await api('/api/production-report/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),timeoutMs:180000});
        verifyOptions(checked);
        if(result.candidate_fingerprint!==checked.candidate_fingerprint){setResult(checked);throw Error('The preview or workbooks changed. Review the refreshed report before proceeding.');}
        if(checked.unresolved.length){setResult(checked);throw Error('Choose destinations for the enabled new orders, then Check again.');}
        request.fingerprint=checked.fingerprint;
      }
      const data=await api(`/api/production-report/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),timeoutMs:180000});
      if(action!=='revert')verifyOptions(data);
      setRestore(data.revert||null);
      if(action==='revert'){setResult(null);setStatusOverrides({});setConfirmRevert(false);setMessage(data.message);}
      else setResult(data);
      if(data.refreshed_imports?.length)onImportsUpdated?.();
      if(data.import_refresh_warning)setError(data.import_refresh_warning);
    }
    catch(error){setError(error.message);}
    finally{setBusy(false);}
  }
  const invalidateCompletion=()=>{setResult(null);setDetail(null);setStatusOverrides({});setMessage('');};
  const invalidate=()=>{invalidateCompletion();setRestore(null);};
  async function changeStatus(row,status){
    const overrides={...statusOverrides,[row['Order Number']]:status};
    setBusy(true);setError('');
    try{
      const data=await api('/api/production-report/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder,preview_id:Number(preview),routes,status_overrides:overrides,export_options:exportOptions,completion_token:completionUpload?.token}),timeoutMs:180000});
      verifyOptions(data);setStatusOverrides(overrides);setResult(data);setCustomOrder(null);setEditingStatus(null);
      const file=(data.candidate_reports||data.reports).find(file=>file.kind===detail.kind);
      setDetail(detail.statusChanges?{...file,orders:file.changed_orders||[],statusChanges:true}:file);
    }catch(error){setError(error.message);}finally{setBusy(false);}
  }
  function statusCell(row,column){
    if(column!=='Status')return undefined;
    const options=[...new Set([...statusChoices,...Object.values(statusOverrides),row.Status])].filter(Boolean).sort();
    if(editingStatus!==row['Order Number']||result.completed)return <div className="production-status-display"><span className="production-status-pill">{row.Status}</span>{!result.completed&&<button type="button" className="icon-button" aria-label={`Edit planned status for ${row['Order Number']}`} title="Edit status" disabled={busy} onClick={()=>{setEditingStatus(row['Order Number']);setStatusDraft(row.Status||'');setError('');}}><Pencil size={15}/></button>}</div>;
    return <div className="production-status-editor"><select autoFocus className="production-status-select" aria-label={`Planned status for ${row['Order Number']}`} title={statusDraft} value={statusDraft} disabled={busy} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();event.preventDefault();setEditingStatus(null);}}} onChange={event=>{if(event.target.value==='__custom__'){setCustomOrder(row);setCustomStatus('');}else setStatusDraft(event.target.value);}}>{options.map(status=><option key={status} value={status}>{status}</option>)}<option value="__custom__">＋ Add New Status…</option></select><button type="button" className="icon-button production-status-confirm" aria-label={`Confirm planned status for ${row['Order Number']}`} title="Confirm status" disabled={busy||!statusDraft} onClick={()=>changeStatus(row,statusDraft)}><Check size={18}/></button><button type="button" className="icon-button production-status-cancel" aria-label={`Cancel status edit for ${row['Order Number']}`} title="Cancel edit" disabled={busy} onClick={()=>{setEditingStatus(null);setError('');}}><X size={18}/></button></div>;
  }
  const openOrders=file=>{setDetail(file);setDetailSearch('');setEditingStatus(null);};
  const detailTitle=detail?.kind==='full'?'Full Search':'C-O and Update';
  const detailCategory=detail?.completedTV?'completed_tv':detail?.completionTimes?'completion_times':detail?.statusChanges?'status_changes':'new_orders';
  const appliedCounts=result?.completed?result.reports.reduce((total,file)=>({new_orders:total.new_orders+(file.missing||0),status_changes:total.status_changes+(file.status_changed||0),completion_times:total.completion_times+(file.completion_count||0),completed_tv:total.completed_tv+(file.completed_tv_count||0)}),{new_orders:0,status_changes:0,completion_times:0,completed_tv:0}):null;
  const detailRows=(detail?.orders||[]).filter(row=>!detailSearch.trim()||result.columns.some(column=>String(row[column]??'').toLowerCase().includes(detailSearch.trim().toLowerCase())));
  const searchableRows=useMemo(()=>(result?.rows||[]).map(({Destination,...row})=>row),[result]);
  const conflictDetails=uploadDetails==='conflicts';
  const uploadTitle=conflictDetails?'Conflicting orders excluded':'Orders with completion times';
  const uploadColumns=conflictDetails?['S.No','Order Number','Products','Reported times (U.S. Central)','Indian times (IST)','Action']:['S.No','Order Number','Product','Completion time (IST)','Source files'];
  const searchOrder=uploadSearch.trim().toLowerCase();
  const completionToken=completionUpload?.token;
  const reportFolder=folder.trim();
  const currentSerials=serialLookup?.folder===reportFolder&&serialLookup?.token===completionToken?serialLookup:null;

  useEffect(()=>{
    if(!reportFolder||!completionToken)return;
    const controller=new AbortController();
    api('/api/production-report/completion-serials',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({folder:reportFolder,token:completionToken}),
      signal:controller.signal
    }).then(data=>{
      if(!controller.signal.aborted)setSerialLookup({folder:reportFolder,token:completionToken,serials:data.serials});
    }).catch(error=>{
      if(!controller.signal.aborted)setSerialLookup({folder:reportFolder,token:completionToken,error:error.message});
    });
    return()=>controller.abort();
  },[reportFolder,completionToken]);

  const matchedUpload=useMemo(()=>{
    const serials=currentSerials?.serials;
    if(!serials)return null;
    const matchedRows=rows=>rows?.flatMap(row=>{
      const key=row['Order Number'].trim().toLowerCase();
      return Object.hasOwn(serials,key)?[{...row,'S.No':serials[key]||'—'}]:[];
    });
    return {
      orders:matchedRows(completionUpload?.completion_rows),
      conflicts:matchedRows(completionUpload?.conflict_rows)
    };
  },[currentSerials,completionUpload]);
  const uploadRows=conflictDetails?matchedUpload?.conflicts:matchedUpload?.orders;
  const emptyUploadMessage=(conflictDetails?completionUpload?.conflicts:completionUpload?.orders)===0
    ? (conflictDetails?'No conflicting orders in this upload.':'No orders with completion times in this upload.')
    : 'No orders in this list match the Production Report workbooks.';

  const conflictKpiCounts=useMemo(()=>{
    if(!matchedUpload?.conflicts)return {};
    const counts={all:matchedUpload.conflicts.length};
    for(const row of matchedUpload.conflicts){
      const len=row.times_count||parseConflictCandidates(row).length;
      counts[len]=(counts[len]||0)+1;
    }
    return counts;
  },[matchedUpload]);
  const count2=conflictKpiCounts[2]||0;
  const count3=conflictKpiCounts[3]||0;
  const count4Plus=Object.entries(conflictKpiCounts).reduce((acc,[k,v])=>Number(k)>=4?acc+v:acc,0);

  const filteredUploadRows=useMemo(()=>{
    if(!conflictDetails){
      return searchOrder?(uploadRows||[]).filter(row=>row['Order Number']?.toLowerCase().includes(searchOrder)||(row['Product']&&row['Product']?.toLowerCase().includes(searchOrder))):(uploadRows||[]);
    }
    return (uploadRows||[]).filter(row=>{
      const candLen=row.times_count||parseConflictCandidates(row).length;
      if(conflictFilter===2&&candLen!==2)return false;
      if(conflictFilter===3&&candLen!==3)return false;
      if(conflictFilter==='4+'&&candLen<4)return false;
      if(searchOrder&&!row['Order Number']?.toLowerCase().includes(searchOrder)&&!(row['Products']&&row['Products']?.toLowerCase().includes(searchOrder)))return false;
      return true;
    }).map(row=>{
      const orderNum=row['Order Number'];
      const selections=selectedTimes[orderNum]||[];
      return {
        ...row,
        'Indian times (IST)':selections.map(item=>item.time_ist).join('\n')||'—',
        'Action':selections.length?'Move to Completed':'—'
      };
    });
  },[conflictDetails,uploadRows,conflictFilter,searchOrder,selectedTimes]);

  const selectedOrderNumbers=Object.keys(selectedTimes);
  const selectedOrderCount=selectedOrderNumbers.length;

  function handleToggleCandidate(row,cand){
    const orderNum=row['Order Number'];
    const limit=row['S.No'].split(',').length;
    setSelectedTimes(prev=>{
      const current=prev[orderNum]||[];
      const selected=current.some(item=>item.time_central===cand.time_central);
      const remaining=current.filter(item=>item.time_central!==cand.time_central&&item.product!==cand.product);
      if(selected){
        const next={...prev};
        const kept=current.filter(item=>item.time_central!==cand.time_central);
        if(kept.length)next[orderNum]=kept;
        else delete next[orderNum];
        return next;
      }
      if(limit>1&&remaining.length>=limit)return prev;
      const choice={
        time_central:cand.time_central,
        time_ist:cand.time_ist||centralToIst(cand.time_central),
        source_file:cand.files_str||(cand.files||[]).join(', '),
        product:cand.product,
        byProduct:limit>1
      };
      return {...prev,[orderNum]:[...(limit>1?remaining:[]),choice]};
    });
    if(editingIstOrder?.orderNum===orderNum)cancelDraftIst();
  }

  function startEditIst(orderNum,selection){
    setEditingIstOrder({orderNum,central:selection.time_central});
    const currentIst=selection.time_ist;
    const str = String(currentIst || '').trim();
    const m = str.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/);
    if (m) {
      setDraftDate(m[1]);
      setDraftTime(m[2] ? (m[2].length === 5 ? `${m[2]}:00` : m[2]) : '00:00:00');
    } else {
      const now = new Date();
      setDraftDate(now.toISOString().slice(0, 10));
      setDraftTime('00:00:00');
    }
  }

  function saveDraftIst(orderNum){
    if (!draftDate) return;
    const formattedTime = draftTime ? (draftTime.length === 5 ? `${draftTime}:00` : draftTime) : '00:00:00';
    const combined = `${draftDate} ${formattedTime}`.trim();
    setSelectedTimes(prev=>({
      ...prev,
      [orderNum]:(prev[orderNum]||[]).map(item=>item.time_central===editingIstOrder.central
        ? {...item,time_ist:combined}:item)
    }));
    setEditingIstOrder(null);
  }

  function cancelDraftIst(){
    setEditingIstOrder(null);
    setDraftDate('');
    setDraftTime('');
  }

  async function resolveOrders(orderNums){
    if(!orderNums.length||busy)return;
    const resolutions=orderNums.flatMap(num=>(selectedTimes[num]||[]).map(item=>({
      order_number:num,
      time_ist:item.time_ist,
      source_file:item.source_file,
      time_central:item.time_central,
      ...(item.byProduct?{product:item.product}:{}),
    }))).filter(item=>item.time_ist);
    if(!resolutions.length)return;
    setBusy(true);
    setUploadDetailsError('');
    try{
      const route=resolutions.some(item=>item.product)?'resolve-product-conflicts':'resolve-conflicts-version';
      const data=await api(`/api/production-report/${route}`,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({token:completionUpload.token,resolutions}),
        timeoutMs:180000
      });
      if(!data.token||data.token===completionUpload.token)throw Error('The server did not return an updated completion report.');
      setConflictHistory(({undo})=>({undo:[...undo,completionUpload],redo:[]}));
      setCompletionUpload({...completionUpload,...data});
      setSelectedTimes(prev=>{
        const next={...prev};
        orderNums.forEach(num=>delete next[num]);
        return next;
      });
      if(editingIstOrder&&orderNums.includes(editingIstOrder.orderNum))setEditingIstOrder(null);
      setConflictNotice(`Resolved and moved ${orderNums.length} order(s) to completed orders.`);
      if(data.conflicts===0)setUploadDetails(current=>current==='conflicts'?null:current);
      invalidateCompletion();
    }catch(err){
      if(err.status===404&&err.message==='Unknown action'){
        setUploadDetailsError(window.desktop
          ? 'This TV Tracker engine does not support Undo and Redo for order updates. Fully quit and reopen the updated app, then retry.'
          : 'The running workspace server does not support Undo and Redo for order updates. Restart it from the updated workspace, reload this page, and retry.');
      }else{
        setUploadDetailsError(err.message);
      }
    }finally{
      setBusy(false);
    }
  }

  function applyConflictProducts(rows, products){
    if(busy)return;
    const {selections,selected,needsReview}=selectConflictProducts(rows,products,selectedTimes,parseConflictCandidates,centralToIst);
    setSelectedTimes(selections);
    cancelDraftIst();
    setConflictNotice(`Products selected in ${selected} order(s).${needsReview?` Review product or completion time in ${needsReview} order(s).`:''}`);
  }

  function restoreConflictUpdate(direction){
    const previous=conflictHistory[direction].at(-1);
    if(busy||!previous)return;
    const opposite=direction==='undo'?'redo':'undo';
    setConflictHistory({
      [direction]:conflictHistory[direction].slice(0,-1),
      [opposite]:[...conflictHistory[opposite],completionUpload]
    });
    setCompletionUpload(previous);
    setSelectedTimes({});
    setConflictFilter('all');
    setUploadSearch('');
    cancelDraftIst();
    setUploadDetailsError('');
    setConflictNotice(direction==='undo'?'Order update undone.':'Order update reapplied.');
    invalidateCompletion();
  }

  function conflictCell(row,column){
    const orderNum=row['Order Number'];
    if(column==='Order Number')return <span className="conflict-order-cell">{orderNum}</span>;
    if(column==='Products'){
      const candidates=parseConflictCandidates(row);
      if(!candidates.length){
        return <span className="conflict-product-name">{row['Products']||row.Product||'—'}</span>;
      }
      return <div className="conflict-products-list">
        {candidates.map((cand,idx)=>{
          const isChecked=selectedTimes[orderNum]?.some(item=>item.time_central===cand.time_central)||false;
          const prodName=cand.product||row['Products']||row.Product||'—';
          return <button type="button" key={idx} className={`conflict-product-option ${isChecked?'is-checked':''}`} title={`${prodName} / ${cand.time_central}`} aria-pressed={isChecked} onClick={()=>handleToggleCandidate(row,cand)}>
            <span className="conflict-product-name">{prodName}</span>
          </button>;
        })}
      </div>;
    }
    if(column==='Reported times (U.S. Central)'){
      const candidates=parseConflictCandidates(row);
      return <div className="conflict-time-options">
        {candidates.map((cand,idx)=>{
          const isChecked=selectedTimes[orderNum]?.some(item=>item.time_central===cand.time_central)||false;
          const fileName=cand.files_str||(cand.files||[]).join(', ')||'ExcelReport.xlsx';
          return <div key={idx} className={`conflict-time-option ${isChecked?'is-checked':''}`}>
            <span className="conflict-time-label">
              <span className="conflict-time-ts">{cand.time_central}</span>{' '}
              <strong className="conflict-report-filename">({fileName})</strong>
            </span>
          </div>;
        })}
      </div>;
    }
    if(column==='Indian times (IST)'){
      const selections=selectedTimes[orderNum]||[];
      if(!selections.length){
        return <span className="muted conflict-unselected-hint">Select a product</span>;
      }
      return <div className="conflict-products-list">{selections.map(selected=>{
        if(editingIstOrder?.orderNum===orderNum&&editingIstOrder.central===selected.time_central){
          return <div key={selected.time_central} className="conflict-ist-editor">
            <div className="conflict-date-picker-wrap" title="Click to select date from calendar" onClick={e=>e.currentTarget.querySelector('input')?.showPicker?.()}>
              <CalendarDays size={16} className="conflict-calendar-icon" aria-hidden="true"/>
              <input
                type="date"
                autoFocus
                className="conflict-ist-date-input"
                value={draftDate}
                onChange={e=>setDraftDate(e.target.value)}
                onClick={e=>e.currentTarget.showPicker?.()}
                onKeyDown={e=>{
                  if(e.key==='Enter'){e.preventDefault();saveDraftIst(orderNum);}
                  if(e.key==='Escape'){e.preventDefault();cancelDraftIst();}
                }}
                aria-label="Select date from calendar"
              />
            </div>
            <TimeFields
              label="Indian completion time"
              value={draftTime}
              onChange={setDraftTime}
              onKeyDown={e=>{
                if(e.key==='Enter'){e.preventDefault();saveDraftIst(orderNum);}
                if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelDraftIst();}
              }}
            />
            <button type="button" className="icon-button conflict-btn-confirm" title="Confirm date and time" onClick={()=>saveDraftIst(orderNum)}><Check size={16}/></button>
            <button type="button" className="icon-button conflict-btn-cancel" title="Cancel edit" onClick={cancelDraftIst}><X size={16}/></button>
          </div>;
        }
        return <div key={selected.time_central} className="conflict-ist-display">
          <span className="conflict-ist-val">{selected.byProduct&&<>{selected.product}: </>}{selected.time_ist}</span>
          <button type="button" className="icon-button conflict-btn-edit" title="Edit Indian date and time" onClick={()=>startEditIst(orderNum,selected)}><Pencil size={15}/></button>
        </div>;
      })}</div>;
    }
    if(column==='Action'){
      const selected=selectedTimes[orderNum];
      if(!selected)return <span className="muted">—</span>;
      return <button type="button" className="primary conflict-btn-move" disabled={busy} onClick={()=>resolveOrders([orderNum])} title="Move to completed orders">
        <Check size={14}/> Move to Completed
      </button>;
    }
    return undefined;
  }

  function openUploadDetails(type){
    setUploadSearch('');setUploadDetailsError('');setConflictNotice('');setUploadDetails(type);
    const rows=type==='conflicts'?completionUpload.conflict_rows:completionUpload.completion_rows;
    const count=type==='conflicts'?completionUpload.conflicts:completionUpload.orders;
    if(count>0&&(!Array.isArray(rows)||rows.length!==count)){
      if(completionUpload.localFiles?.length)uploadCompletion(completionUpload.localFiles,{refreshDetails:true});
      else setUploadDetailsError('Upload the ExcelReports again to load order details for this batch.');
    }
  }
  const uploadSearchField=<label className="search-input production-orders-search"><Search size={16}/><input aria-label="Search by order number" placeholder="Search by order number" value={uploadSearch} onChange={event=>setUploadSearch(event.target.value)}/></label>;
  return <section className="production-report">
    <div className="production-report-header"><div className="section-heading"><div><h2>Production Report</h2><p className="muted">Add missing preview orders to your two production workbooks.</p></div></div>
    <div className="production-report-search"><ReportOrderSearch name="Production Report" rows={searchableRows} columns={result?.columns||[]} disabled={!result||busy}/>{!result&&<p className="muted">Click Check folder &amp; orders below to load the selected preview for order-number search.</p>}</div>
    </div>
    <div className="production-report-controls">
      <label>Production report folder<input aria-label="Production report folder" placeholder={'C:\\Users\\Harikrishna\\Desktop\\PR'} value={folder} disabled={busy} onChange={event=>{setFolder(event.target.value);invalidate();}}/></label>
      <p className="muted">Paste the folder containing one C-O and Update workbook and one Full Search workbook. Local folders and accessible network paths are supported.</p>
      <label>Source preview<select aria-label="Production report preview" value={preview} disabled={busy} onChange={event=>{setPreview(event.target.value);invalidate();}}><option value="" disabled>Choose a saved preview</option>{previews.map(item=><option key={item.id} value={item.id}>{item.name} · {item.row_count} captured rows</option>)}</select></label>
      <div className={`production-completion-upload${completionDragging?' is-dragging':''}`} onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect=busy?'none':'copy';if(!busy)setCompletionDragging(true);}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget))setCompletionDragging(false);}} onDrop={event=>{event.preventDefault();setCompletionDragging(false);uploadCompletion(event.dataTransfer.files);}} aria-busy={busy}><FileSpreadsheet size={30} aria-hidden="true"/><h3>Completed ExcelReports</h3><p className="muted">Proceed writes the exact date and time shown in Orders with completion times to Excel Out Time for matching orders.</p><label className="production-upload-button"><Upload size={18} aria-hidden="true"/><span>{completionUpload?'Replace ExcelReports':'Upload multiple files'}</span><input type="file" multiple accept=".xlsx" aria-label="Upload completed ExcelReport" disabled={busy} onChange={event=>{uploadCompletion(event.target.files);event.target.value='';}}/></label>
      <p className="muted">Up to 30 .xlsx files · 20 MB per file · 100 MB total. A new upload replaces the selected batch.</p>

      {completionUpload&&<div className="production-upload-summary">
        <p role="status">{completionUpload.files||1} files selected · <button type="button" disabled={busy} className="production-upload-count" onClick={()=>openUploadDetails('orders')}>{matchedUpload?.orders&&`${matchedUpload.orders.length} `}orders with completion times</button> · <button type="button" disabled={busy} className="production-upload-count" onClick={()=>openUploadDetails('conflicts')}>{matchedUpload?.conflicts&&`${matchedUpload.conflicts.length} `}conflicting orders excluded</button></p>
        <ul>{(completionUpload.names||[completionUpload.name]).map((name,index)=><li key={`${index}-${name}`}>
          <span>{name}</span>
          {completionUpload.localFiles&&<button type="button" className="production-remove-file" aria-label={`Remove ${name}`} title={`Remove ${name}`} disabled={busy} onClick={()=>removeCompletion(index)}><X size={16} aria-hidden="true"/></button>}
        </li>)}</ul>
        <button type="button" className="secondary" disabled={busy} onClick={clearCompletion}>Remove completion reports</button>
      </div>}
      </div>

      <div className="production-main-actions"><button className="secondary action-check" disabled={busy||!folder.trim()||!preview||!anyExport} onClick={()=>run('check')}><Search size={18}/>{busy?'Working…':'Check folder & orders'}</button><button className="primary action-proceed" disabled={busy||!result||result.completed||(exportOptions.new_orders&&!!result.unresolved.length)||!anyExport} onClick={()=>run('proceed')}><CheckCircle2 size={19}/>Proceed — update selected orders</button><button type="button" className="secondary action-revert" disabled={busy||!restore} onClick={()=>{setError("");setConfirmRevert(true);}} title="Restore the workbooks from before the latest Proceed"><Undo2 size={19}/>Revert Excel</button></div>
      <fieldset className="production-export-options" disabled={busy}><legend>Choose what to update in Excel</legend><div className="production-export-switches">{[['new_orders','Newly orders'],['status_changes','Status changed'],['completion_times','Completion times'],['completed_tv','Completed in TV']].map(([key,label])=><button key={key} type="button" role="switch" aria-label={label} aria-checked={exportOptions[key]} onClick={()=>{setExportOptions({...exportOptions,[key]:!exportOptions[key]});setDetail(null);setEditingStatus(null);setMessage('');setError('');}}><span>{label}</span><span className="production-switch-track" aria-hidden="true"><span className="production-switch-thumb"/><span>{exportOptions[key]?'ON':'OFF'}</span></span></button>)}</div>{!anyExport&&<p role="status">Turn on at least one option to continue.</p>}</fieldset>
    </div>
    {uploadDetails&&completionUpload&&<Dialog title={uploadTitle} className="production-orders-dialog production-upload-dialog" initialFocus=".production-orders-search input" onClose={()=>setUploadDetails(null)}>
      <div className="dialog-content">
        {conflictDetails&&<div className="conflict-dialog-controls">
          <div className="conflict-dialog-intro">
            <p className="production-status-help">These orders have different completion times in the uploaded reports and were excluded from the batch.</p>
            {!busy&&uploadRows?.length>0&&uploadSearchField}
          </div>
          <div className="conflict-history-actions">
            <button type="button" className="secondary" disabled={busy||!conflictHistory.undo.length} onClick={()=>restoreConflictUpdate('undo')}><Undo2 size={16}/>Undo</button>
            <button type="button" className="secondary" disabled={busy||!conflictHistory.redo.length} onClick={()=>restoreConflictUpdate('redo')}><Redo2 size={16}/>Redo</button>
          </div>
        </div>}
        {conflictDetails&&conflictNotice&&<div className="conflict-success-banner" role="status"><Check size={16}/><span>{conflictNotice}</span><button type="button" className="icon-button" onClick={()=>setConflictNotice('')}><X size={14}/></button></div>}
        {uploadDetailsError&&Array.isArray(uploadRows)&&uploadRows.length>0&&<div className="notice warning conflict-error-banner" role="alert"><AlertTriangle size={16}/><span>{uploadDetailsError}</span><button type="button" className="icon-button" onClick={()=>setUploadDetailsError('')}><X size={14}/></button></div>}
        {!uploadRows?.length&&uploadDetailsError?<p role="alert">{uploadDetailsError}</p>:
          !reportFolder?<p>Set the Production report folder to find matching orders.</p>:
          currentSerials?.error?<p role="alert">{currentSerials.error}</p>:
          busy||!matchedUpload?<p role="status">Finding matching orders…</p>:
          !uploadRows?.length?<p>{emptyUploadMessage}</p>:<>
            {!conflictDetails&&uploadSearchField}
            <DataTable
              name={uploadTitle}
              columns={uploadColumns}
              rows={filteredUploadRows}
              beforeTable={conflictDetails?(rows)=>(
              <div className="conflict-kpi-bar" role="group" aria-label="Conflict match filter">
                <button type="button" className="conflict-kpi-pill" aria-pressed={conflictFilter==='all'} onClick={()=>setConflictFilter('all')}>
                  <span className="kpi-label">All</span>
                  <strong className="kpi-count">{conflictKpiCounts.all||0}</strong>
                </button>
                <button type="button" className="conflict-kpi-pill" aria-pressed={conflictFilter===2} onClick={()=>setConflictFilter(2)}>
                  <span className="kpi-label">2 Days Match</span>
                  <strong className="kpi-count">{count2}</strong>
                </button>
                <button type="button" className="conflict-kpi-pill" aria-pressed={conflictFilter===3} onClick={()=>setConflictFilter(3)}>
                  <span className="kpi-label">3 Days Match</span>
                  <strong className="kpi-count">{count3}</strong>
                </button>
                {count4Plus>0&&<button type="button" className="conflict-kpi-pill" aria-pressed={conflictFilter==='4+'} onClick={()=>setConflictFilter('4+')}>
                  <span className="kpi-label">4+ Days Match</span>
                  <strong className="kpi-count">{count4Plus}</strong>
                </button>}
                <ConflictProductPicker products={conflictProductChoices(rows,parseConflictCandidates)} selectedProducts={selectedConflictProducts(rows,selectedTimes,parseConflictCandidates)} disabled={busy} onApply={products=>applyConflictProducts(rows,products)}/>
              </div>
              ):undefined}
              toolbar={conflictDetails&&selectedOrderCount>0?(
                <button type="button" className="primary btn-move-batch" disabled={busy} onClick={()=>resolveOrders(selectedOrderNumbers)} title="Move all selected orders to completed">
                  <CheckCircle2 size={16}/>Move Selected to Completed ({selectedOrderCount})
                </button>
              ):undefined}
              renderCell={conflictDetails?conflictCell:undefined}
              filterable={false}
            />
          </>}
      </div>
    </Dialog>}
    {error&&<div role="alert" className="production-revert-warning production-proceed-warning"><span className="production-revert-warning-icon" aria-hidden="true"><AlertTriangle size={26}/></span><div><strong>Action needed to continue</strong><p>{error}</p></div></div>}
    {customOrder&&<Dialog title="Add production status" className="production-add-status-dialog" onClose={()=>{if(!busy)setCustomOrder(null);}}><form className="dialog-content" onSubmit={event=>{event.preventDefault();changeStatus(customOrder,customStatus.trim());}}><p className="production-add-status-context">Add a status for <strong>{customOrder['Order Number']}</strong>.</p><label htmlFor="production-new-status">New status<input id="production-new-status" autoFocus required autoComplete="off" aria-label="New planned status" placeholder="e.g. Waiting for review" maxLength={256} value={customStatus} disabled={busy} onChange={event=>setCustomStatus(event.target.value)}/></label><p className="production-add-status-hint">This selects the status for your planned update. Click Proceed later to apply it to Excel.</p>{error&&<p className="notice warning" role="alert">{error}</p>}<div className="production-add-status-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setCustomOrder(null)}>Cancel</button><button type="submit" className="primary" disabled={busy||!customStatus.trim()}>{busy?'Saving…':'Use status'}</button></div></form></Dialog>}
    {message&&<SuccessNotice title="Excel reverted successfully"><p>{message}</p></SuccessNotice>}
    {result?.completed&&<SuccessNotice title="Excel updated successfully"><p>{appliedCounts.new_orders} orders added · {appliedCounts.status_changes} statuses changed · {appliedCounts.completion_times} completion times updated · {appliedCounts.completed_tv} orders marked Completed in TV. The enabled export categories were applied to Excel. Disabled categories were left unchanged. Your previous Excel files are backed up and can be restored with Revert Excel.</p><div className="inline">{result.downloads.map(file=><a className="secondary" key={file.url} href={file.url} download>Download {file.name}</a>)}</div></SuccessNotice>}
    {confirmRevert&&<Dialog title="Revert Excel" className="production-revert-dialog" onClose={()=>{if(!busy)setConfirmRevert(false);}}><div className="dialog-content"><p>Restore both production workbooks to their state before the latest Proceed? This removes orders added by that action and restores their previous statuses and data.</p><p>Close the Excel files first. If they were edited after Proceed, the restore will stop to protect those edits.</p>{error&&<div role="alert" className="production-revert-warning"><span className="production-revert-warning-icon" aria-hidden="true"><AlertTriangle size={26}/></span><div><strong>Action needed before restoring</strong><p>{error}</p></div></div>}<div className="inline"><button type="button" className="secondary" disabled={busy} onClick={()=>setConfirmRevert(false)}>Cancel</button><button type="button" className="primary" disabled={busy} onClick={()=>run('revert')}>{busy?'Reverting…':'Restore previous Excel'}</button></div></div></Dialog>}
    {result&&<>
      <div className="production-report-files">{(result.candidate_reports||result.reports).map(file=><article key={file.kind}><h3><button type="button" className="production-file-title" disabled={busy} onClick={()=>openOrders(file)} aria-haspopup="dialog">{file.kind==='full'?'Full Search':'C-O and Update'}</button></h3><p>{file.name}</p><div className="production-order-actions"><button type="button" className={`production-order-count${exportOptions.new_orders?'':' is-excluded'}`} disabled={busy} onClick={()=>openOrders(file)} aria-haspopup="dialog" aria-label={`${file.kind==='full'?'Full Search':'C-O and Update'}: ${file.missing} ${result.completed&&result.export_options?.new_orders?'orders added':'Newly orders'}`}><strong>{file.missing}</strong><span className="production-metric-label">{result.completed&&result.export_options?.new_orders?'orders added':'Newly orders'}</span><span className="production-category-state">{exportOptions.new_orders?'Included':'OFF — skipped'}</span><span>View orders ↗</span></button><button type="button" className={`production-order-count${exportOptions.status_changes?'':' is-excluded'}`} disabled={busy} aria-haspopup="dialog" onClick={()=>openOrders({...file,orders:file.changed_orders||[],statusChanges:true})}><strong>{file.status_changed||0}</strong><span className="production-metric-label">Status Changed</span><span className="production-category-state">{exportOptions.status_changes?'Included':'OFF — skipped'}</span><span>View orders</span></button><button type="button" className={`production-order-count${exportOptions.completion_times?'':' is-excluded'}`} disabled={busy} onClick={()=>openOrders({...file,orders:file.completion_orders||[],completionTimes:true})}><strong>{file.completion_count||0}</strong><span className="production-metric-label">Completion times {result.completed&&result.export_options?.completion_times?'updated':'to update'}</span><span className="production-category-state">{exportOptions.completion_times?'Included':'OFF — skipped'}</span><span>View orders</span></button><button type="button" className={`production-order-count${exportOptions.completed_tv?'':' is-excluded'}`} disabled={busy} aria-haspopup="dialog" aria-label={`${file.kind==='full'?'Full Search':'C-O and Update'}: Completed in TV, ${file.completed_tv_count||0} orders`} onClick={()=>openOrders({...file,orders:file.completed_tv_orders||[],completedTV:true})}><strong>{file.completed_tv_count||0}</strong><span className="production-metric-label">Completed in TV</span><span className="production-category-state">{exportOptions.completed_tv?'Included':'OFF — skipped'}</span><span>View orders</span></button></div><p>{file.completion_kept||0} existing Out Times preserved · {file.completion_unmatched||0} completed rows without a matching time</p><p>{file.existing} existing · {file.skipped} preview orders already present</p></article>)}</div>
      {exportOptions.new_orders&&!!result.unresolved.length&&<div className="production-report-controls"><h3>Choose destinations for unfamiliar products</h3><p>These products are not assigned uniquely by the existing files. Select their report, then check again.</p>{result.unresolved.map(product=><label key={product}>{product}<select aria-label={`Destination for ${product}`} value={routes[product]||''} onChange={event=>setRoutes({...routes,[product]:event.target.value})}><option value="">Choose report</option><option value="co">C-O and Update</option><option value="full">Full Search</option></select></label>)}<button className="secondary" disabled={busy} onClick={()=>run('check')}>Recheck destinations</button></div>}
      <p className="report-context">{result.preview_name} · Orders below use the Google Sheet column order. Destination workbooks retain their own headers and worksheet formatting.</p>
      <DataTable rows={result.rows} columns={result.columns} name="Preview orders in Google Sheet columns" filters={{}} openFilter={()=>{}} filterable={false}/>
    </>}
    {detail&&result&&<Dialog title={detailTitle+' — '+(detail.completedTV?'Matched Orders Not Marked as Completed in Production Reports':detail.completionTimes?'completion times':detail.statusChanges?'status changes':result.completed&&result.export_options?.new_orders?'orders added':'Newly orders')} onClose={()=>setDetail(null)} className="production-orders-dialog" initialFocus=".production-orders-search input"><div className="dialog-content">{!exportOptions[detailCategory]&&<p className="notice warning">OFF — skipped. These are candidate orders for review; this category will not be written to Excel.</p>}<p className="production-status-help">{detail.completedTV?'Matched Orders Not Marked as Completed in Production Reports. These orders have a completion time in your uploaded ExcelReports. Proceed marks them Completed and Delivered and fills missing Out Times, moving weekend dates to Friday.':'Click the pencil to edit a status, ✓ to confirm, or ✕ to cancel. Confirmed choices apply to Excel when you click Proceed. Saved preview statuses are unchanged.'}</p>{error&&<p className="notice warning" role="alert">{error}</p>}<p className="muted">{detail.name} · {result.preview_name} · {detail.orders?.length||0} candidate orders · {exportOptions[detailCategory]?'Included':'OFF — skipped'}</p><label className="search-input production-orders-search"><Search size={16}/><input aria-label="Search report orders" placeholder="Search order number, product, status or any column…" value={detailSearch} onChange={event=>setDetailSearch(event.target.value)}/></label><DataTable key={detail.kind} rows={detailRows} columns={detail.completedTV?['Order Number','PreviousStatus','Status','Previous Out Time','Out Time']:detail.completionTimes?['Order Number','Previous Out Time','Out Time']:detail.statusChanges?['Order Number','Product','PreviousStatus','Status','State','County','Client']:result.columns} renderCell={detail.completionTimes||detail.completedTV?undefined:statusCell} name={detailTitle+' orders'} filters={{}} openFilter={()=>{}} filterable={false}/></div></Dialog>}
  </section>;
}
