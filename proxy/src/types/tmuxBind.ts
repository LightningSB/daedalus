export type TmuxBindTarget =
  | { kind: 'ssh-host'; hostId: string; tmuxSession: string }
  | { kind: 'ssh-host-docker'; hostId: string; containerId: string; tmuxSession: string }
  | { kind: 'ssh-raw'; rawCommand: string; tmuxSession: string }
  | { kind: 'local-tmux'; tmuxSession: string };

export type TmuxBind = {
  id: string;          // bind-<uuid>
  title: string;       // sidebar label
  createdAt: string;
  updatedAt: string;
  target: TmuxBindTarget;
  lastOpenedAt?: string;
  autoFocus?: boolean;
};
