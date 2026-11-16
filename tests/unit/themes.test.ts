import {describe,expect,it} from 'vitest';
import {contrastRatio,getTheme,terminalTheme,themeIdSchema,themeIds,themes} from '../../src/shared/themes';
import {initialState,stateSchema} from '../../src/shared/models';

describe('built-in appearance catalogue',()=>{
 it('contains the default and all eighteen requested presets with stable unique IDs',()=>{
  expect(themes).toHaveLength(19);expect(new Set(themes.map(theme=>theme.id)).size).toBe(19);
  expect(themes.map(theme=>theme.id)).toEqual([...themeIds]);
  expect(contrastRatio('#000000','#FFFFFF')).toBe(21);
  for(const value of ['unknown','url(https://example.com)','chocolate;display:none',{},null])expect(themeIdSchema.safeParse(value).success).toBe(false);
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
 });
});
