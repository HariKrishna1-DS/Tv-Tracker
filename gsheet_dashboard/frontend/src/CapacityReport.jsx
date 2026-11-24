import {LoadingScreen, useActivity} from './LoadingExperience';
import {FilterableTable} from './ColumnFilters';
import React, {useEffect,useState} from 'react';
import {ResponsiveContainer,ComposedChart,Bar,Line,AreaChart,Area,XAxis,YAxis,CartesianGrid,Tooltip,Legend} from 'recharts';
import {api} from './workspaceUtils';
import {OfflineNotice} from './DesktopExperience';
import ReportOrderSearch from './ReportOrderSearch';
const DateOrdersDialog=React.lazy(()=>import('./DateOrdersDialog'));
const displayDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value))?`${value.slice(8,10)}-${value.slice(5,7)}-${value.slice(2,4)}`:/^\d{4}-\d{2}$/.test(String(value))?new Intl.DateTimeFormat('en',{month:'short',year:'2-digit',timeZone:'UTC'}).format(new Date(`${value}-01T00:00:00Z`)).replace(' ','-'):value;
const countGroups={'Received':'received','Completed':'completed','Clarification':'clarification','Cancelled':'cancelled','Vendor Pending':'vendor','In-House Pending':'in_house','Capacity':'received','Ext capacity':'received'};
const backlogSeries=[
  {key:'In-House Pending',color:'#5266cb'},
  {key:'Vendor Pending',color:'#b77912'},
  {key:'Clarification',color:'#c65243'},
];

function BacklogPoint({cx,cy,payload,stroke,series,onSelect}) {
  if(!Number.isFinite(cx)||!Number.isFinite(cy)||!payload)return null;
  const open=event=>{
    event.stopPropagation();
    onSelect(payload.Date,series);
  };
  return <g role="button" tabIndex={0} className="capacity-backlog-point"
    aria-label={`${displayDate(payload.Date)}, ${series}: ${payload[series]??0} orders`}
    onClick={open} onKeyDown={event=>{
      if(event.key!=='Enter'&&event.key!==' ')return;
      event.preventDefault();
      open(event);
    }}>
    <circle cx={cx} cy={cy} r={8} fill="transparent"/>
    <circle cx={cx} cy={cy} r={2} fill={stroke} stroke="var(--surface)"/>
  </g>;
}

function BacklogTrends({rows,onSelect}) {
  const data=[...rows].sort((a,b)=>a.Date.localeCompare(b.Date));
  const peak=data.reduce((max,row)=>Math.max(max,...backlogSeries.map(({key})=>Number(row[key])||0)),0);
  const step=2*Math.pow(2,Math.max(0,Math.ceil(Math.log2(Math.max(1,peak/16)))));
  const intervals=Math.max(3,Math.ceil(peak/step));
  const ticks=Array.from({length:intervals+1},(_,index)=>index*step);
  return <section className="daily-chart" aria-label="Pending & Backlog Trends">
    <h2>Pending &amp; Backlog Trends</h2>
    {data.length>0&&<p className="muted capacity-chart-hint">Select a point to view its orders.</p>}
    {data.length ? <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={data} margin={{top:12,right:20,bottom:4,left:0}}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3"/>
        <XAxis dataKey="Date" tickFormatter={displayDate} tick={{fill:'var(--muted)',fontSize:11}} minTickGap={14}/>
        <YAxis domain={[0,intervals*step]} ticks={ticks} allowDecimals={false} tick={{fill:'var(--muted)',fontSize:11}}/>
        <Tooltip labelFormatter={displayDate} contentStyle={{background:'var(--surface)',borderColor:'var(--line)',color:'var(--text)'}}/>
        <Legend/>
        {backlogSeries.map(({key,color})=><Area key={key} type="monotone" dataKey={key} stroke={color} strokeWidth={2} fill={color} fillOpacity={0.1}
          dot={<BacklogPoint series={key} onSelect={onSelect}/>}
          activeDot={false}
          isAnimationActive={false}/>)}
      </AreaChart>
    </ResponsiveContainer> : <p className="muted">No daily capacity data to chart.</p>}
  </section>;
}

function BacklogBreakdown({rows,onSelect}) {
  const counts=backlogSeries.map(series=>({...series,count:rows.reduce((sum,row)=>sum+(Number(row[series.key])||0),0)}));
  const total=counts.reduce((sum,{count})=>sum+count,0);
  const percent=new Intl.NumberFormat(undefined,{style:'percent',maximumFractionDigits:1});
  let cumulative=0;
  const stops=counts.filter(({count})=>count>0).map(({color,count})=>{
    const start=cumulative/total;
    cumulative+=count;
    return `${color} ${start}turn ${cumulative/total}turn`;
  });
  function selectSlice(event){
    const {width,height,left,top}=event.currentTarget.getBoundingClientRect();
    const x=(event.clientX-left)/width-.5;
    const y=(event.clientY-top)/height-.5;
    const angle=(Math.atan2(x,-y)/(2*Math.PI)-25/360+1)%1;
    const index=Math.min(total-1,Math.floor(angle*total));
    let end=0;
    const slice=counts.find(({count})=>{
      end+=count;
      return index<end;
    });
    if(slice)onSelect(slice.key);
  }
  return <section className="daily-chart capacity-backlog-breakdown" aria-label="Backlog Breakdown">
    <h2>Backlog Breakdown</h2>
    {total>0 ? <>
      <div className="capacity-pie" aria-hidden="true" style={{'--capacity-pie-fill':stops.length===1
        ? counts.find(({count})=>count>0).color
        : `conic-gradient(from 25deg,${stops.join(',')})`}}>
        <div className="capacity-pie-hit-area" onClick={selectSlice}/>
      </div>
      <ul className="capacity-pie-legend">
        {counts.map(({key,color,count})=><li key={key}><button type="button" onClick={()=>onSelect(key)}>
          <span className="capacity-pie-swatch" style={{backgroundColor:color}} aria-hidden="true"/>
          <span>{key}</span>
          <strong>{count.toLocaleString()} ({percent.format(count/total)})</strong>
        </button></li>)}
      </ul>
    </> : <p className="muted">No pending orders or clarifications in this period.</p>}
  </section>;
}

export default function CapacityReport({revision,running}) {
  const [report,setReport]=useState(null),[capacity,setCapacity]=useState(700),[extended,setExtended]=useState(750),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useActivity(busy,'Saving capacity…');
  const [detailDate,setDetailDate]=useState(null),[detailMonth,setDetailMonth]=useState(null);
  const [countDetail,setCountDetail]=useState(null);
  async function refresh(){try{const value=await api('/api/capacity-report');setReport(value);setCapacity(value.capacity);setExtended(value.extended_capacity);setError('');}catch(e){setReport(previous=>previous?{...previous,offline:true}:null);setError(e.message);}}
  useEffect(()=>{refresh();const timer=setInterval(()=>{if(!document.hidden)refresh();},30000);return()=>clearInterval(timer);},[revision,running]);
  async function save(){setBusy(true);try{const value=await api('/api/report-capacity',{method:'POST',timeoutMs:180000,headers:{'Content-Type':'application/json'},body:JSON.stringify({capacity:Number(capacity),extended_capacity:Number(extended)})});await refresh();if(!value.publication.synced&&!value.publication.queued)setError(`Saved locally. Sheets update needs retry: ${value.publication.sync_error}`);}catch(e){setError(e.message);}finally{setBusy(false);}}
  const total=(label,rows)=>({Date:label,...Object.fromEntries((report?.columns||[]).slice(1).map(column=>[column,rows.reduce((sum,row)=>sum+Number(row[column]||0),0)]))});
  function showCount(row,column,options={}){
    const period=/^\d{4}-\d{2}-\d{2}$/.test(row.Date)?{date:row.Date}:/^\d{4}-\d{2}$/.test(row.Date)?{month:row.Date,aggregate:true}:row.Date==='Total'?{month:report.month,aggregate:true}:{year:report.month.slice(0,4),aggregate:true};
    setCountDetail({...period,...options,initialGroup:countGroups[column],target:column.includes('capacity')||column==='Capacity'?`${column}: ${row[column]??0}. The table shows received orders against this target.`:''});
  }
  const table=(title,rows)=><section className="table-section"><h2>{title}</h2><div className="table-scroll"><FilterableTable><thead><tr>{report.columns.map(column=><th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.Date} className={row.Date.includes('Total')?`capacity-total ${row.Date==='Total'?'capacity-daily-total':''}`:row.Date===detailDate||row.Date===detailMonth?'daily-date-selected':undefined}>{report.columns.map(column=><td key={column}>{column==='Date'?/^\d{4}-\d{2}(-\d{2})?$/.test(row.Date)?<button type="button" className="text-button" aria-pressed={row.Date===detailDate||row.Date===detailMonth} onClick={()=>row.Date.length===7?setDetailMonth(row.Date):setDetailDate(row.Date)}>{displayDate(row.Date)}</button>:displayDate(row[column]):<button type="button" className="text-button" aria-label={`${displayDate(row.Date)}, ${column}: ${row[column]??0}`} onClick={()=>showCount(row,column)}>{row[column]??0}</button>}</td>)}</tr>)}</tbody></FilterableTable></div></section>;
  if(!report&&!error)return <LoadingScreen title="Loading capacity report…"/>;
  return <section className="daily-orders capacity-report"><div className="section-heading"><h2>PR Excel</h2><a className="secondary" href="/api/export/report?sheet=PR%20Excel" download>Download PR Excel</a></div>
    <ReportOrderSearch name="Capacity Report" scope="capacity" revision={report} disabled={!report} renderSearch={searchField=>(
      <div className="capacity-toolbar"><div className="monthly-actions"><label>Daily capacity<input type="number" min="0" step="1" value={capacity} onChange={e=>setCapacity(e.target.value)}/></label><label>Extended daily capacity<input type="number" min="0" step="1" value={extended} onChange={e=>setExtended(e.target.value)}/></label><button className="primary" disabled={busy||running} onClick={save}>{busy?'Saving…':'Save capacity'}</button></div><div className="capacity-order-field">{searchField}</div></div>
    )}/>

    {report?.import_required&&<p className="notice">Import Excel files to populate Capacity Report.</p>}
    <div className="capacity-report-tools">
      {report&&<details className="report-notes">
        <summary>Capacity report details</summary>
        <p className="report-context">Capacity Report uses imported Excel orders. Saturday and Sunday receipts and completions are included on the preceding Friday.</p>
        {report.completion_date_basis==='out_time'&&<p className="report-context">Completed counts use each Completed and Delivered order’s Out Time, including orders received in earlier months. A date can have completions even when no orders were received that day.{report.missing_completion_date_count>0&&` ${report.missing_completion_date_count} completed orders have a blank or invalid Out Time and are excluded from completed counts.`}</p>}
        <p className="report-context">{report.source} · {report.scope_label||report.month}</p>
      </details>}
    </div>
    {error&&<p className="notice warning" role="alert">{error}</p>}
    <OfflineNotice snapshot={report}/>

    {report&&<>{table('Monthly capacity',[...report.monthly,total(`${report.month.slice(0,4)} YTD Total`,report.monthly.filter(row=>row.Date.startsWith(report.month.slice(0,4))))])}{table('Daily capacity',[...report.daily,total('Total',report.daily)])}<section className="daily-chart" aria-label="Capacity report chart"><h2>Overall · {report.scope_label||report.month}</h2><div style={{height:360}}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={report.daily}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="Date"/><YAxis/><Tooltip/><Legend/><Bar dataKey="Received" fill="#315c9b" isAnimationActive={false}/><Bar dataKey="Completed" fill="#5ba4cf" isAnimationActive={false}/><Line dataKey="Capacity" stroke="#dc793b" dot={false} isAnimationActive={false}/><Line dataKey="Ext capacity" stroke="#8c93cf" dot={false} isAnimationActive={false}/></ComposedChart></ResponsiveContainer></div></section><div className="capacity-backlog-charts"><BacklogTrends rows={report.daily} onSelect={(date,column)=>showCount({Date:date},column,{hideSummary:true})}/><BacklogBreakdown rows={report.daily} onSelect={column=>showCount({Date:'Total'},column,{hideSummary:true,dateSecond:true})}/></div></>}
    {detailDate&&<React.Suspense fallback={null}><DateOrdersDialog key={detailDate} kind="capacity" date={detailDate} onClose={()=>setDetailDate(null)} onUpdated={refresh}/></React.Suspense>}
    {detailMonth&&<React.Suspense fallback={null}><DateOrdersDialog key={detailMonth} kind="capacity" month={detailMonth} onClose={()=>setDetailMonth(null)} onUpdated={refresh}/></React.Suspense>}
    {countDetail&&<React.Suspense fallback={null}><DateOrdersDialog kind="capacity" {...countDetail} onClose={()=>setCountDetail(null)} onUpdated={refresh}/></React.Suspense>}
  </section>;
}
