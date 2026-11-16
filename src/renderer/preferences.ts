import {useEffect,useState} from 'react';
import {settingsViewSchema,type SettingsView} from '../shared/settings';
let value:SettingsView|null=null,revision=0,started=false;
const listeners=new Set<()=>void>();
function publish(input:unknown){value=settingsViewSchema.parse(input);revision++;for(const cb of listeners)cb();}
function start(){if(started)return;started=true;window.sshOS.settings.onChanged(publish);const before=revision;void window.sshOS.settings.get().then(next=>{if(before===revision)publish(next);}).catch(()=>{});}
export function usePreferences(){const [,render]=useState(0);useEffect(()=>{start();const cb=()=>render(x=>x+1);listeners.add(cb);cb();return()=>{listeners.delete(cb);};},[]);return value;}
