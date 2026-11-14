import { useEffect, useState, type FormEvent } from 'react';
import { profileViewSchema, type ProfileDraft, type ProfileView } from '../shared/models';

const messages: Record<string, string> = {
  INPUT_INVALID: '입력 형식을 확인하세요.', PROFILE_LIMIT: '서버는 최대 10개 등록할 수 있습니다.',
  PROFILE_BUSY: '연결 또는 작업 중인 서버의 접속 설정을 변경할 수 없습니다.',
  KEY_INVALID: '개인키를 다시 선택하세요.', STORAGE_FAILED: '앱 데이터를 저장하거나 읽지 못했습니다.'
};
function message(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  return Object.entries(messages).find(([code]) => text.includes(code))?.[1] ?? '요청을 처리하지 못했습니다.';
}
const empty = (): ProfileDraft => ({ name: '', host: '', port: 22, username: '', authentication: 'password' });

export function ProfileManager({ disabled }: { disabled: boolean }) {
  const [profiles, setProfiles] = useState<ProfileView[]>([]);
  const [draft, setDraft] = useState<ProfileDraft>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [keyName, setKeyName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => setProfiles((await window.sshOS.profile.list()).map(row => profileViewSchema.parse(row)));
  useEffect(() => { if (!disabled) void refresh().catch(error => setError(message(error))); }, [disabled]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (editing) await window.sshOS.profile.update(editing, draft); else await window.sshOS.profile.create(draft);
      setDraft(empty()); setEditing(null); setKeyName(''); await refresh();
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  };
  return <section className="profile-manager" aria-label="연결 관리자">
    <div className="profile-list"><h2>내 서버 <span>{profiles.length}/10</span></h2>
      {profiles.length === 0 && <p>첫 Linux 서버를 등록하세요.</p>}
      {profiles.map(profile => <article key={profile.id}>
        <strong>{profile.name}</strong><p>{profile.username}@{profile.host}:{profile.port}</p>
        <span>{profile.authentication === 'key' ? `개인키 · ${profile.keyFilename ?? ''}` : '비밀번호 인증'}</span>
        <div className="profile-actions"><button disabled={disabled || busy} onClick={() => {
          setEditing(profile.id); setDraft({ name: profile.name, host: profile.host, port: profile.port, username: profile.username, authentication: profile.authentication }); setKeyName(profile.keyFilename ?? ''); setError('');
        }}>수정</button><button disabled={disabled || busy} onClick={() => {
          if (!window.confirm(`${profile.name}의 로컬 연결 프로필을 삭제할까요? 원격 서버의 파일은 삭제하지 않습니다.`)) return;
          setBusy(true); void window.sshOS.profile.delete(profile.id).then(refresh).catch(error => setError(message(error))).finally(() => setBusy(false));
        }}>삭제</button></div>
      </article>)}
    </div>
    <form onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} onSubmit={event => { void submit(event); }}>
      <h2>{editing ? '접속 설정 수정' : '서버 등록'}</h2>
      <fieldset disabled={disabled || busy}>
        <label>서버 이름<input required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>호스트<input required placeholder="서버 주소 또는 IP" value={draft.host} onChange={e => setDraft({ ...draft, host: e.target.value })} /></label>
        <div className="field-row"><label>포트<input required type="number" min="1" max="65535" value={draft.port} onChange={e => setDraft({ ...draft, port: Number(e.target.value) })} /></label>
          <label>사용자명<input required value={draft.username} onChange={e => setDraft({ ...draft, username: e.target.value })} /></label></div>
        <label>인증 방식<select value={draft.authentication} onChange={e => { const { keyToken: _token, ...rest } = draft; setDraft({ ...rest, authentication: e.target.value === 'key' ? 'key' : 'password' }); setKeyName(''); }}><option value="password">비밀번호</option><option value="key">SSH 개인키</option></select></label>
        {draft.authentication === 'key' && <div className="key-picker"><button type="button" onClick={() => { void window.sshOS.profile.pickKey().then(selected => { if (selected) { setDraft({ ...draft, keyToken: selected.token }); setKeyName(selected.filename); } }).catch(error => setError(message(error))); }}>개인키 선택</button><span>{keyName || '선택한 파일 없음'}</span></div>}
        <p className="help">비밀번호와 키 암호는 연결할 때 입력합니다. 기본적으로 저장하지 않습니다.</p>
        <button className="primary" type="submit">{busy ? '저장 중…' : editing ? '설정 저장' : '서버 등록'}</button>
        {editing && <button type="button" onClick={() => { setEditing(null); setDraft(empty()); setKeyName(''); }}>취소</button>}
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  </section>;
}
