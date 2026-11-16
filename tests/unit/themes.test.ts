import {describe,expect,it} from 'vitest';
import {contrastRatio,getTheme,terminalTheme,themeIdSchema,themeIds,themes,storedThemeIdSchema} from '../../src/shared/themes';
import {initialState,stateSchema} from '../../src/shared/models';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

describe('built-in appearance catalogue',()=>{
 it('contains seventeen unique active themes with original fantasy replacing League',()=>{
  expect(themes).toHaveLength(17);expect(new Set(themes.map(theme=>theme.id)).size).toBe(17);
  expect(themes.map(theme=>theme.id)).toEqual([...themeIds]);
  expect(contrastRatio('#000000','#FFFFFF')).toBe(21);
  expect(themes.find(theme=>theme.id==='fantasy')?.label).toBe('판타지');
  for(const value of ['dragonball','doraemon','league','unknown','url(https://example.com)','chocolate;display:none',{},null])expect(themeIdSchema.safeParse(value).success).toBe(false);
 });
 it('ships seventeen different inert wallpaper renders with editable geometry masters',()=>{
  const hashes=new Set<string>();
  for(const theme of themes){
   const base=resolve('src/renderer/assets/themes',theme.id),png=readFileSync(base+'.png'),svg=readFileSync(base+'.svg','utf8');
   expect(png.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
   expect([png.readUInt32BE(16),png.readUInt32BE(20)]).toEqual([1600,1000]);
   expect(svg).not.toMatch(/<(?:script|foreignObject|image|style|text)\b|\bon\w+\s*=|\b(?:href|src)\s*=/i);
   hashes.add(createHash('sha256').update(png).digest('hex'));
  }
  expect(hashes.size).toBe(17);
 });
 it.each(themes)('$id keeps readable text and primary/selected/focus states across its surfaces',theme=>{
  expect(getTheme(themeIdSchema.parse(theme.id))).toBe(theme);
  for(const color of Object.values(theme.colors))expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  for(const background of [theme.colors.background,theme.colors.sidebar,theme.colors.surface,theme.colors.raised]){
   expect(contrastRatio(theme.colors.text,background)).toBeGreaterThanOrEqual(4.5);
   expect(contrastRatio(theme.colors.secondary,background)).toBeGreaterThanOrEqual(4.5);
   expect(contrastRatio(theme.colors.focus,background)).toBeGreaterThanOrEqual(3);
  }
  expect(contrastRatio(theme.colors.accentText,theme.colors.selected)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(theme.colors.onAccent,theme.colors.accent)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(theme.colors.controlBoundary,theme.colors.background)).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(theme.colors.dangerText,theme.colors.dangerBackground)).toBeGreaterThanOrEqual(4.5);
  const terminal=terminalTheme(theme);
  expect(terminal.background).toBe(theme.colors.background);expect(terminal.foreground).toBe(theme.colors.text);
  expect(terminal.selectionForeground).toBe(theme.colors.accentText);
  for(const color of Object.values(terminal))expect(color).toMatch(/^#[0-9a-f]{6}$/i);
 });
 it('defaults only missing legacy preferences and rejects invalid saved theme identifiers',()=>{
  const legacy:unknown={profiles:[],hostTrust:[],encryptedSecrets:[],settings:{language:'ko',saveSecrets:false}};
  expect(stateSchema.parse(legacy).settings.theme).toBe('chocolate');
  expect(initialState().settings.theme).toBe('chocolate');
  expect(()=>stateSchema.parse({...initialState(),settings:{...initialState().settings,theme:'untrusted'}})).toThrow();
  for(const id of themeIds)expect(storedThemeIdSchema.parse(id)).toBe(id);
  for(const [old,current] of [['dragonball','chocolate'],['doraemon','chocolate'],['league','fantasy']]){
   expect(stateSchema.parse({...initialState(),settings:{...initialState().settings,theme:old}}).settings.theme).toBe(current);
  }
 });
});
