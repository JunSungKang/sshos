import {getTheme,themes,themeIdSchema,type ThemeId} from '../shared/themes';

export function ThemeSettings({value,disabled,change}:{value:ThemeId;disabled:boolean;change(action:()=>Promise<void>):Promise<void>}){
 const theme=getTheme(value);
 return <section className="settings-section appearance-settings" aria-labelledby="appearance-heading">
  <div className="settings-section-heading"><h3 id="appearance-heading">테마와 색상</h3><p>편안한 색을 선택하세요. 선택한 테마는 바로 적용되고 다음 실행에도 유지됩니다.</p></div>
  <div className="appearance-layout">
   <div className="appearance-choice"><label htmlFor="theme-choice">앱 테마</label><select id="theme-choice" aria-label="테마" value={value} disabled={disabled} onChange={event=>{const next=event.currentTarget.value;void change(()=>window.sshOS.settings.setTheme(themeIdSchema.parse(next)));}}>{themes.map(item=><option key={item.id} value={item.id}>{item.label} 테마</option>)}</select><p>{theme.description}</p><small>Desktop · Console · 탐색기 · 설정에 함께 적용됩니다.</small></div>
   <div className="theme-preview" aria-label="선택한 테마 미리보기" style={{background:theme.colors.background,color:theme.colors.text,borderColor:theme.colors.boundary}}>
    <div className="theme-preview-title" style={{background:theme.colors.raised}}><strong>sshOS</strong><span>{theme.scheme==='dark'?'다크':'라이트'}</span></div>
    <div className="theme-preview-content"><div className="theme-preview-swatches" aria-hidden="true">{[theme.colors.sidebar,theme.colors.surface,theme.colors.accent,theme.colors.selected].map((color,index)=><i key={index} style={{background:color,borderColor:theme.colors.boundary}}/>)}</div><strong>{theme.label}</strong><span className="theme-preview-action" style={{background:theme.colors.accent,color:theme.colors.onAccent}}>선택한 테마</span></div>
   </div>
  </div>
 </section>;
}
