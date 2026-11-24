import React from 'react';

const parts = [
  {label:'HH', name:'Hours', max:23},
  {label:'MM', name:'Minutes', max:59},
  {label:'SS', name:'Seconds', max:59},
].map(part=>({...part,values:Array.from({length:part.max+1},(_,value)=>String(value).padStart(2,'0'))}));

export default function TimeFields({label,value,onChange,onKeyDown}) {
  const [hours='00',minutes='00',seconds='00']=(value||'').split(':');
  const values=[hours,minutes,seconds];
  return <div className="time-fields" role="group" aria-label={label} onKeyDown={onKeyDown}>
    {parts.map(({label:heading,name,values:options},index)=><label key={name}>
      <span>{heading}</span>
      <select aria-label={name} value={values[index]} onChange={event=>{
        const next=[...values];
        next[index]=event.target.value;
        onChange(next.join(':'));
      }}>
        {options.map(option=><option key={option} value={option}>{option}</option>)}
      </select>
    </label>)}
  </div>;
}
