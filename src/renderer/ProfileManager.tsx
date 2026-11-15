import { errorCodeOf } from '../shared/errors';
import { ErrorPanel } from './ErrorPanel';
import { useEffect, useState, type FormEvent } from 'react';
import { profileViewSchema, type ProfileDraft, type ProfileView } from '../shared/models';
import { hostChallengeSchema, sessionViewSchema, type HostChallenge, type SessionView, type SessionCredentials } from '../shared/session-contracts';
import { ConnectionPrompt, HostTrustPrompt } from './ConnectionPrompt';

const message=errorCodeOf;
const profileTarget=(profile:ProfileView)=>`${profile.name} | ${profile.username}@${profile.host}:${profile.port}`;
const empty = (): ProfileDraft => ({ name: '', host: '', port: 22, username: '', authentication: 'password' });

export function ProfileManager({ disabled }: { disabled: boolean }) {
  const [profiles, setProfiles] = useState<ProfileView[]>([]);
  const [draft, setDraft] = useState<ProfileDraft>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [keyName, setKeyName] = useState('');
  const [error, setError] = useState('');
  const [errorTarget,setErrorTarget]=useState<string|null>(null);
  const report=(value:unknown,target:string|null)=>{setError(message(value));setErrorTarget(target);};
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [challenges, setChallenges] = useState<HostChallenge[]>([]);
  const [connecting, setConnecting] = useState<ProfileView | null>(null);
  const refresh = async () => setProfiles((await window.sshOS.profile.list()).map(row => profileViewSchema.parse(row)));
  useEffect(() => { if (!disabled) void refresh().catch(error => report(error,'로컬 연결 프로필 목록')); }, [disabled]);
  useEffect(() => {
    let alive = true;
    const update = () => { void window.sshOS.session.list().then(value => { if (alive) { setSessions(value.sessions.map(row => sessionViewSchema.parse(row))); setChallenges(value.challenges.map(row => hostChallengeSchema.parse(row))); } }).catch(() => {}); };
    update(); const timer = setInterval(update, 500); return () => { alive = false; clearInterval(timer); };
  }, []);
  const attempt = (profile: ProfileView, credentials: SessionCredentials) => {
    setBusy(true); setError('');
    void window.sshOS.session.connect(profile.id, credentials).catch(error => report(error,profileTarget(profile))).finally(() => setBusy(false));
  };
  const runTrust = (challenge: HostChallenge, approve: boolean) => {
    setBusy(true); setError('');
    void (approve ? window.sshOS.trust.approve(challenge.challengeId) : window.sshOS.trust.reject(challenge.challengeId)).catch(error => report(error,challenge.endpoint)).finally(() => setBusy(false));
  };
  const identityLocked = Boolean(editing && sessions.some(row => row.serverId === editing && !['idle','failed','disconnected'].includes(row.status)));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (editing) await window.sshOS.profile.update(editing, draft); else await window.sshOS.profile.create(draft);
      setDraft(empty()); setEditing(null); setKeyName(''); await refresh();
    } catch (error) { report(error,`${draft.name} | ${draft.username}@${draft.host}:${draft.port}`); } finally { setBusy(false); }
  };
  return <section className="profile-manager" aria-label="연결 관리자">
    <div className="profile-list"><h2>내 서버 <span>{profiles.length}/10</span></h2>
      {profiles.length === 0 && <p>첫 Linux 서버를 등록하세요.</p>}
      {profiles.map(profile => {
        const session = sessions.find(row => row.serverId === profile.id);
        const active = session && !['idle', 'failed', 'disconnected'].includes(session.status);
        return <article key={profile.id}>
        <strong>{profile.name}</strong><p>{profile.username}@{profile.host}:{profile.port}</p>
        <span>{profile.authentication === 'key' ? `개인키 · ${profile.keyFilename ?? ''}` : '비밀번호 인증'}</span>
        <p className="session-state">{session?.status === 'connected' ? '연결됨' : session?.status === 'awaiting_host_trust' ? '서버 지문 확인 대기' : session?.status === 'connecting' || session?.status === 'authenticating' ? '연결 중' : '연결 안 됨'}</p>
        {session?.status === 'connected' && <p>{session.os === 'supported' ? 'Ubuntu 24.04' : session.os === 'unsupported' ? '지원하지 않는 서버 OS' : session.osConfirmed ? 'OS 미확인 · 사용자 확인' : 'OS 미확인'} · {session.sftp === 'available' ? 'SFTP 사용 가능' : session.sftp === 'unavailable' ? 'SFTP 사용 불가' : '기능 확인 중'}</p>}
        {session?.status === 'connected' && session.os === 'unknown' && !session.osConfirmed && <button onClick={() => { void window.sshOS.session.confirmOS(profile.id, session.generation).catch(error => report(error,profileTarget(profile))); }}>Ubuntu 24.04 서버임을 확인</button>}
        {session?.errorCode && <ErrorPanel error={session.errorCode} phase={session.status} target={`${profile.username}@${profile.host}:${profile.port}`}/>}
        <div className="profile-actions"><button disabled={disabled || busy} onClick={() => {
          if (active) { setBusy(true); void window.sshOS.session.disconnect(profile.id).catch(error => report(error,profileTarget(profile))).finally(() => setBusy(false)); }
          else setConnecting(profile);
        }}>{active ? '연결 해제' : '연결'}</button><button disabled={disabled || busy} onClick={() => {
          setEditing(profile.id); setDraft({ name: profile.name, host: profile.host, port: profile.port, username: profile.username, authentication: profile.authentication }); setKeyName(profile.keyFilename ?? ''); setError('');
        }}>수정</button><button disabled={disabled || busy} onClick={() => {
          if (!window.confirm(`${profile.name}의 로컬 연결 프로필을 삭제할까요? 원격 서버의 파일은 삭제하지 않습니다.`)) return;
          setBusy(true); void window.sshOS.profile.delete(profile.id).then(refresh).catch(error => report(error,profileTarget(profile))).finally(() => setBusy(false));
        }}>삭제</button></div>
      </article>;
      })}
    </div>
    <form onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} onSubmit={event => { void submit(event); }}>
      <h2>{editing ? '접속 설정 수정' : '서버 등록'}</h2>
      <fieldset disabled={disabled || busy}>
        <label>서버 이름<input required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <fieldset disabled={identityLocked}><label>호스트<input required placeholder="서버 주소 또는 IP" value={draft.host} onChange={e => setDraft({ ...draft, host: e.target.value })} /></label>
        <div className="field-row"><label>포트<input required type="number" min="1" max="65535" value={draft.port} onChange={e => setDraft({ ...draft, port: Number(e.target.value) })} /></label>
          <label>사용자명<input required value={draft.username} onChange={e => setDraft({ ...draft, username: e.target.value })} /></label></div>
        <label>인증 방식<select value={draft.authentication} onChange={e => { const { keyToken: _token, ...rest } = draft; setDraft({ ...rest, authentication: e.target.value === 'key' ? 'key' : 'password' }); setKeyName(''); }}><option value="password">비밀번호</option><option value="key">SSH 개인키</option></select></label>
        {draft.authentication === 'key' && <div className="key-picker"><button type="button" onClick={() => { void window.sshOS.profile.pickKey().then(selected => { if (selected) { setDraft({ ...draft, keyToken: selected.token }); setKeyName(selected.filename); } }).catch(error => report(error,'로컬 개인키 선택')); }}>개인키 선택</button><span>{keyName || '선택한 파일 없음'}</span></div>}
        </fieldset><p className="help">비밀번호와 키 암호는 연결할 때 입력합니다. 기본적으로 저장하지 않습니다.</p>
        <button className="primary" type="submit">{busy ? '저장 중…' : editing ? '설정 저장' : '서버 등록'}</button>
        {editing && <button type="button" onClick={() => { setEditing(null); setDraft(empty()); setKeyName(''); }}>취소</button>}
      </fieldset>
      {error && <ErrorPanel error={error} phase={null} target={errorTarget}/>}
    </form>
    {connecting && <ConnectionPrompt profile={connecting} close={() => setConnecting(null)} submit={credentials => attempt(connecting, credentials)} />}
    {challenges[0] && <HostTrustPrompt key={challenges[0].challengeId} challenge={challenges[0]} busy={busy} approve={() => runTrust(challenges[0]!, true)} reject={() => runTrust(challenges[0]!, false)} />}
  </section>;
}
