import { Injectable, inject, signal } from '@angular/core';
import { FinanceRepository, SyncEntities } from './repository/finance.repository';

export type SyncState = 'offline' | 'syncing' | 'synced' | 'error';

const LAST_SYNC_KEY = 'finanzbuch-last-sync';

@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly repository = inject(FinanceRepository);
  protected readonly baseUrl = '/api';
  readonly state = signal<SyncState>(navigator.onLine ? 'synced' : 'offline');
  private debounceHandle?: ReturnType<typeof setTimeout>;
  private refreshHandle?: ReturnType<typeof setInterval>;
  private onRemoteSync?: () => void;
  private syncing = false;

  init(onRemoteSync: () => void): void {
    this.onRemoteSync = onRemoteSync;
    window.addEventListener('online', () => this.syncNow());
    window.addEventListener('offline', () => this.state.set('offline'));
    this.refreshHandle ??= setInterval(() => void this.syncNow(), 30_000);
    if (navigator.onLine) void this.syncNow();
  }

  /** Called after any local write; batches rapid successive changes into a single sync request. */
  notifyChange(): void {
    if (!navigator.onLine) { this.state.set('offline'); return; }
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    this.debounceHandle = setTimeout(() => void this.syncNow(), 1500);
  }

  async syncNow(): Promise<void> {
    if (this.syncing || !navigator.onLine) return;
    this.syncing = true;
    this.state.set('syncing');
    try {
      const entities = await this.repository.snapshot();
      const since = localStorage.getItem(LAST_SYNC_KEY);
      const response = await fetch(`${this.baseUrl}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since, entities }),
      });
      if (!response.ok) throw new Error(`Sync fehlgeschlagen: ${response.status}`);
      const data = (await response.json()) as { serverTime: string; entities: Partial<SyncEntities> };
      await this.repository.applyRemoteSnapshot(data.entities);
      localStorage.setItem(LAST_SYNC_KEY, data.serverTime);
      this.onRemoteSync?.();
      this.state.set('synced');
    } catch {
      this.state.set(navigator.onLine ? 'error' : 'offline');
    } finally {
      this.syncing = false;
    }
  }
}
