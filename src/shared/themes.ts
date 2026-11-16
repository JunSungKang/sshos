import {z} from 'zod';

export const themeIds=['chocolate','atom','ubuntu','centos','kali','windows11','windows98','windowsxp','ghost','city','countryside','league','starcraft','dragonball','doraemon','river','sky','mountain','island'] as const;
export const themeIdSchema=z.enum(themeIds);
export type ThemeId=z.infer<typeof themeIdSchema>;
type BaseColors={background:string;sidebar:string;surface:string;selected:string;accent:string;text:string};

function rgb(value:string){return [1,3,5].map(offset=>parseInt(value.slice(offset,offset+2),16));}
function blend(a:string,b:string,amount:number){const left=rgb(a),right=rgb(b);return '#'+left.map((value,index)=>Math.round(value*(1-amount)+right[index]!*amount).toString(16).padStart(2,'0')).join('');}
function luminance(value:string){const channels=rgb(value).map(channel=>{const v=channel/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;});return channels[0]!*0.2126+channels[1]!*0.7152+channels[2]!*0.0722;}
export function contrastRatio(a:string,b:string){const first=luminance(a),second=luminance(b);return (Math.max(first,second)+0.05)/(Math.min(first,second)+0.05);}
const readableOn=(background:string)=>contrastRatio(background,'#101010')>contrastRatio(background,'#FFFFFF')?'#101010':'#FFFFFF';

function defineTheme(id:ThemeId,label:string,description:string,scheme:'dark'|'light',base:BaseColors){
 const emphasis=blend(base.accent,base.text,0.6);
 const colors={...base,
  raised:blend(base.surface,base.text,0.045),hover:blend(base.surface,base.text,0.09),
  secondary:blend(base.text,base.surface,0.22),boundary:blend(base.surface,base.text,0.12),
  controlBoundary:blend(base.background,base.text,scheme==='dark'?0.44:0.62),focus:base.accent,
  accentText:contrastRatio(emphasis,base.selected)>=4.5?emphasis:readableOn(base.selected),onAccent:readableOn(base.accent),
  disabled:blend(base.text,base.surface,0.3),folderFront:blend(base.accent,base.surface,0.12),
  dangerBackground:scheme==='dark'?'#3C2628':'#FFF0ED',dangerText:scheme==='dark'?'#F0B0A8':'#962F2B',dangerBorder:scheme==='dark'?'#744C43':'#C89187',
  success:scheme==='dark'?'#A8CDA7':'#28643C'
 };
 return {id,label,description,scheme,colors};
}

/** Original offline palettes inspired by the requested names; no upstream assets. */
export const themes=[
 defineTheme('chocolate','다크초코 · 기본','짙은 초콜릿과 따뜻한 골드','dark',{background:'#211A16',sidebar:'#1B1512',surface:'#2B221D',selected:'#463823',accent:'#B99A45',text:'#E8DFD2'}),
 defineTheme('atom','아톰','흑연색 바탕과 차분한 블루','dark',{background:'#282C34',sidebar:'#21252B',surface:'#303640',selected:'#384A61',accent:'#61AFEF',text:'#E0E6EF'}),
 defineTheme('ubuntu','우분투','오베르진과 선명한 오렌지','dark',{background:'#241521',sidebar:'#1C101C',surface:'#341F32',selected:'#543144',accent:'#F28C62',text:'#F5E8EF'}),
 defineTheme('centos','CentOS','자주색과 라임의 균형','dark',{background:'#201B2D',sidebar:'#181421',surface:'#2D263E',selected:'#493A50',accent:'#BDD379',text:'#EEEAF5'}),
 defineTheme('kali','Kali Linux','짙은 네이비와 전기빛 블루','dark',{background:'#111B2A',sidebar:'#0D1521',surface:'#1A2940',selected:'#214269',accent:'#75B8FA',text:'#E2ECF8'}),
 defineTheme('windows11','윈도우11','밝은 회백색과 부드러운 블루','light',{background:'#EDF1F8',sidebar:'#E5EAF3',surface:'#FAFCFF',selected:'#D9E6FA',accent:'#245FB5',text:'#263447'}),
 defineTheme('windows98','윈도우98','회색 입체감과 클래식 네이비','light',{background:'#D3D5D4',sidebar:'#C6CAC9',surface:'#E5E7E6',selected:'#173E70',accent:'#174F86',text:'#20272C'}),
 defineTheme('windowsxp','윈도우XP','맑은 파랑과 생동감 있는 초록','light',{background:'#EAF1E9',sidebar:'#E0EAF4',surface:'#F9FCF4',selected:'#D8E9FA',accent:'#357A2A',text:'#253545'}),
 defineTheme('ghost','고스트','안개빛 회백색과 은은한 보라','light',{background:'#F0EEF6',sidebar:'#E7E3EF',surface:'#FCFAFF',selected:'#E2DBF0',accent:'#6D4F9C',text:'#352D43'}),
 defineTheme('city','도시','슬레이트와 도시의 청록빛','dark',{background:'#172028',sidebar:'#111920',surface:'#222F39',selected:'#254950',accent:'#71C9CB',text:'#E1EAF0'}),
 defineTheme('countryside','시골','린넨과 올리브의 포근함','light',{background:'#F1EEE1',sidebar:'#E6E1CE',surface:'#FBF9EE',selected:'#E0E7CD',accent:'#566D36',text:'#343B2B'}),
 defineTheme('league','리그오브레전드','심해색과 오래된 금빛','dark',{background:'#101D29',sidebar:'#0B141E',surface:'#192A38',selected:'#3F3C2D',accent:'#C9AA62',text:'#EFE4CB'}),
 defineTheme('starcraft','스타크래프트','금속성 차콜과 신호등 같은 녹색','dark',{background:'#151D1C',sidebar:'#101615',surface:'#24302E',selected:'#304B3B',accent:'#9ACB87',text:'#DEE9DD'}),
 defineTheme('dragonball','드래곤볼','따뜻한 크림과 활기찬 오렌지','light',{background:'#F6EEDC',sidebar:'#E9E4D5',surface:'#FFFAED',selected:'#FFE4BC',accent:'#A94712',text:'#343B4C'}),
 defineTheme('doraemon','도라에몽','깨끗한 하늘색과 경쾌한 파랑','light',{background:'#E9F5FB',sidebar:'#D8EBF5',surface:'#FAFDFF',selected:'#D4EAF9',accent:'#186CA5',text:'#233D50'}),
 defineTheme('river','자연(강)','흐르는 물결의 청록과 푸른 회색','dark',{background:'#12272C',sidebar:'#0E1E22',surface:'#1D373E',selected:'#27545C',accent:'#8BD3D0',text:'#E0F0EE'}),
 defineTheme('sky','자연(하늘)','햇빛처럼 밝은 흰색과 맑은 파랑','light',{background:'#EAF4FC',sidebar:'#DAEAF6',surface:'#FBFDFF',selected:'#D7EAF8',accent:'#246997',text:'#283F54'}),
 defineTheme('mountain','자연(산)','침엽수의 녹색과 흙의 온기','dark',{background:'#18231D',sidebar:'#121B16',surface:'#27352B',selected:'#3D4C32',accent:'#C4C98A',text:'#E8EDDC'}),
 defineTheme('island','자연(무인도)','밝은 모래와 잔잔한 바다색','light',{background:'#F5F0DF',sidebar:'#E7EDDF',surface:'#FFFCF0',selected:'#D6EBE4',accent:'#236F6C',text:'#2B4643'})
] as const;
export type AppearanceTheme=(typeof themes)[number];
const byId=Object.fromEntries(themes.map(theme=>[theme.id,theme])) as Record<ThemeId,AppearanceTheme>;
export function getTheme(id:ThemeId):AppearanceTheme{return byId[id];}
export function terminalTheme(theme:AppearanceTheme){
 const dark=theme.scheme==='dark';
 return {background:theme.colors.background,foreground:theme.colors.text,cursor:theme.colors.focus,cursorAccent:theme.colors.background,selectionBackground:theme.colors.selected,selectionForeground:theme.colors.accentText,
  black:dark?'#22272E':'#242C37',red:dark?'#F19A94':'#A32D38',green:dark?'#A8D49A':'#28683A',yellow:dark?'#E2C784':'#76521A',blue:dark?'#8EBEED':'#285FA0',magenta:dark?'#CCA9E9':'#804295',cyan:dark?'#8CD1D1':'#146C77',white:dark?'#DFE5ED':'#596574',
  brightBlack:dark?'#7D8998':'#626E7D',brightRed:dark?'#FFBAB3':'#A32D38',brightGreen:dark?'#C2E8B4':'#28683A',brightYellow:dark?'#F4DFAB':'#76521A',brightBlue:dark?'#B2D6FF':'#285FA0',brightMagenta:dark?'#E0C8F6':'#804295',brightCyan:dark?'#B4E7E4':'#146C77',brightWhite:dark?'#FFFFFF':'#343F4D'};
}
