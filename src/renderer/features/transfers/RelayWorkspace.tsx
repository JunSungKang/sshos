import {
  createContext,
  useContext,
  useEffect,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import type { RelayView } from "../../../shared/relay";
import type { SessionView } from "../../../shared/session-contracts";
import {
  acceptsRelayDrag,
  canRelay,
  relayDragType,
  type RelaySource,
} from "./relay-input";
import { RelayDialog, type RelayIntent } from "./RelayDialog";
import "./relay.css";

type Drag = { nonce: string; source: RelaySource };
type Actions = {
  drag: Drag | null;
  begin(event: DragEvent<HTMLElement>, source: RelaySource): void;
  end(): void;
  copy(source: RelaySource, destination?: SessionView): void;
  retry(job: RelayView): void;
};
const ActionsContext = createContext<Actions | null>(null);
const JobsContext = createContext<{ jobs: RelayView[]; listError: boolean }>({
  jobs: [],
  listError: false,
});
export const useRelayActions = () => useContext(ActionsContext);
export const useRelayJobs = () => useContext(JobsContext);

export function RelayWorkspace({
  sessions,
  children,
  shellClass,
}: {
  sessions: SessionView[];
  children: ReactNode;
  shellClass: string;
}) {
  const [intent, setIntent] = useState<RelayIntent | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [jobs, setJobs] = useState<RelayView[]>([]);
  const [listError, setListError] = useState(false);
  const end = () => setDrag(null);
  useEffect(() => {
    // dragend can be lost if the originating virtualized file row unmounts.
    window.addEventListener("dragend", end);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("dragend", end);
      window.removeEventListener("blur", end);
    };
  }, []);
  useEffect(() => {
    let alive = true,
      pending = false;
    async function poll() {
      if (pending) return;
      pending = true;
      try {
        const rows = await window.sshOS.relay.list();
        if (alive) {
          setJobs(rows);
          setListError(false);
        }
      } catch {
        if (alive) setListError(true);
      } finally {
        pending = false;
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const copy = (source: RelaySource, destination?: SessionView) => {
    end();
    const current = sessions.find(
      (row) =>
        row.serverId === source.serverId &&
        row.generation === source.generation,
    );
    if (!canRelay(current)) return;
    setIntent({ kind: "copy", source, destination: destination ?? null });
  };
  const begin = (event: DragEvent<HTMLElement>, source: RelaySource) => {
    const value = { nonce: crypto.randomUUID(), source };
    event.dataTransfer.clearData();
    event.dataTransfer.setData(relayDragType, value.nonce);
    event.dataTransfer.effectAllowed = "copy";
    setDrag(value);
  };
  return (
    <ActionsContext.Provider
      value={{
        drag,
        begin,
        end,
        copy,
        retry: (job) => setIntent({ kind: "retry", job }),
      }}
    >
      <JobsContext.Provider value={{ jobs, listError }}>
        <main className={shellClass}>{children}</main>
      </JobsContext.Provider>
      {intent && (
        <RelayDialog
          intent={intent}
          sessions={sessions}
          close={() => setIntent(null)}
        />
      )}
    </ActionsContext.Provider>
  );
}

export function useRelayDropTarget(destination?: SessionView) {
  const actions = useRelayActions();
  const [over, setOver] = useState(false);
  const drag = actions?.drag;
  const eligible = Boolean(
    drag &&
      (!destination ||
        (canRelay(destination) &&
          destination.serverId !== drag.source.serverId)),
  );
  const handles = (event: DragEvent<HTMLElement>) =>
    eligible && acceptsRelayDrag(event.dataTransfer.types, drag?.nonce ?? null);
  return {
    "data-relay-ready": eligible || undefined,
    "data-relay-over": (eligible && over) || undefined,
    onDragOver(event: DragEvent<HTMLElement>) {
      if (!handles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setOver(true);
    },
    onDragLeave(event: DragEvent<HTMLElement>) {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
        setOver(false);
    },
    onDrop(event: DragEvent<HTMLElement>) {
      event.preventDefault();
      setOver(false);
      if (
        drag &&
        handles(event) &&
        event.dataTransfer.getData(relayDragType) === drag.nonce
      ) {
        event.stopPropagation();
        actions?.copy(drag.source, destination);
      }
    },
  };
}
