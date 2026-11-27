import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { membershipRpc } from '../utils/posMembership'

export function usePosMembershipReport(locations,start,end){
 const key=JSON.stringify([...new Set(locations.map(l=>l.id))].sort())
 const scope=key+'/'+start+'/'+end
 const [state,setState]=useState(null)
 useEffect(()=>{
  if(!start||!end||end<start||key==='[]')return
  let active=true
  membershipRpc(supabase,'report',{p_sites:JSON.parse(key),p_start:start,p_end:end}).then(result=>{
   if(active)setState({scope,result})
  }).catch(()=>{if(active)setState({scope,error:'POS membership sales are unavailable.'})})
  return()=>{active=false}
 },[key,start,end,scope])
 return state?.scope===scope?state:null
}
