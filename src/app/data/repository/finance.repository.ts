import { Injectable } from '@angular/core';
import localforage from 'localforage';
import { createId } from '../id';
import { Account, FinanceContext, InvestmentTrade, Tag, TagSection, Transaction, Trip } from '../model/finance.model';

export interface SyncEntities {
  accounts: Account[];
  tags: Tag[];
  sections: TagSection[];
  trips: Trip[];
  transactions: Transaction[];
  investmentTrades: InvestmentTrade[];
}

@Injectable({ providedIn: 'root' })
export class FinanceRepository {
  private readonly transactions = localforage.createInstance({ name: 'finanzbuch', storeName: 'transactions' });
  private readonly accounts = localforage.createInstance({ name: 'finanzbuch', storeName: 'accounts' });
  private readonly tags = localforage.createInstance({ name: 'finanzbuch', storeName: 'tags' });
  private readonly sections = localforage.createInstance({ name: 'finanzbuch', storeName: 'tag_sections' });
  private readonly trips = localforage.createInstance({ name: 'finanzbuch', storeName: 'trips' });
  private readonly investmentTrades = localforage.createInstance({ name: 'finanzbuch', storeName: 'investment_trades' });

  async seed(): Promise<void> {
    const now = new Date().toISOString();
    const sections: TagSection[] = [
      { id: 'income-section', name: 'Einnahmen', kind: 'income', updatedAt: now },
      { id: 'fixed-section', name: 'Fixe Ausgaben', kind: 'expense', updatedAt: now },
      { id: 'variable-section', name: 'Variable Ausgaben', kind: 'expense', updatedAt: now },
    ];
    if (await this.accounts.length()) {
      const existingSectionIds = new Set((await this.listSections()).map((section) => section.id));
      await Promise.all(sections.filter((section) => !existingSectionIds.has(section.id)).map((section) => this.sections.setItem(section.id, section)));
      return;
    }
    const accounts: Account[] = [
      { id: 'tr', name: 'Trade Republic', listed: true, updatedAt: now },
      { id: 'giro', name: 'Girokonto', listed: true, updatedAt: now },
      { id: 'cash', name: 'Bargeld', listed: false, updatedAt: now },
    ];
    const tags: Tag[] = [
      { id: 'income', name: 'Netto Gehalt', sectionId: 'income-section', autoTagTerms: ['gehalt', 'salary'], updatedAt: now },
      { id: 'rent', name: 'Miete', sectionId: 'fixed-section', autoTagTerms: ['vermieter', 'miete'], updatedAt: now },
      { id: 'food', name: 'Lebensmittel', sectionId: 'variable-section', autoTagTerms: ['rewe', 'edeka', 'lidl', 'restaurant'], updatedAt: now },
      { id: 'travel', name: 'Reisen', sectionId: 'variable-section', autoTagTerms: ['airbnb', 'booking', 'bahn'], updatedAt: now },
    ];
    const trips: Trip[] = [{ id: 'portugal-2026', name: 'Portugal 2026', startDate: '2026-09-01', endDate: '2026-10-15', budget: 4500, updatedAt: now }];
    const transactions: Transaction[] = [
      { id: 'seed-1', context: 'home', bookingDate: '2026-08-01', merchant: 'Gehalt', amount: 3200, currency: 'EUR', exchangeRateToEur: 1, amountEur: 3200, accountId: 'giro', tagId: 'income', manuallyTagged: false, updatedAt: '2026-08-01T08:00:00Z', syncStatus: 'pending' },
      { id: 'seed-2', context: 'home', bookingDate: '2026-08-03', merchant: 'Vermieter', amount: -980, currency: 'EUR', exchangeRateToEur: 1, amountEur: -980, accountId: 'giro', tagId: 'rent', manuallyTagged: false, updatedAt: '2026-08-03T08:00:00Z', syncStatus: 'pending' },
      { id: 'seed-3', context: 'home', bookingDate: '2026-08-06', merchant: 'REWE', amount: -67.40, currency: 'EUR', exchangeRateToEur: 1, amountEur: -67.40, accountId: 'giro', tagId: 'food', manuallyTagged: false, updatedAt: '2026-08-06T17:00:00Z', syncStatus: 'pending' },
      { id: 'seed-4', context: 'travel', bookingDate: '2026-09-04', merchant: 'Airbnb Lisboa', amount: -360, currency: 'EUR', exchangeRateToEur: 1, amountEur: -360, accountId: 'tr', tagId: 'travel', manuallyTagged: false, tripId: 'portugal-2026', countryCode: 'PT', updatedAt: '2026-09-04T12:00:00Z', syncStatus: 'pending' },
    ];
    await Promise.all([
      ...sections.map((section) => this.sections.setItem(section.id, section)),
      ...accounts.map((account) => this.accounts.setItem(account.id, account)),
      ...tags.map((tag) => this.tags.setItem(tag.id, tag)),
      ...trips.map((trip) => this.trips.setItem(trip.id, trip)),
      ...transactions.map((transaction) => this.transactions.setItem(transaction.id, transaction)),
    ]);
  }

  async listTransactions(context?: FinanceContext, tripId?: string): Promise<Transaction[]> {
    const result: Transaction[] = [];
    await this.transactions.iterate<Transaction, void>((transaction: Transaction) => {
      if ((!context || transaction.context === context) && (!tripId || transaction.tripId === tripId)) result.push(transaction);
    });
    return result.map((transaction) => ({
      ...transaction,
      exchangeRateToEur: transaction.exchangeRateToEur ?? 1,
      amountEur: transaction.amountEur ?? transaction.amount,
      cashflowType: transaction.cashflowType ?? (transaction.amount >= 0 ? 'income' : 'expense'),
    })).sort((first, second) => second.bookingDate.localeCompare(first.bookingDate));
  }

  async saveTransaction(draft: Omit<Transaction, 'id' | 'updatedAt' | 'syncStatus'> & Partial<Pick<Transaction, 'id'>>): Promise<Transaction> {
    const transaction: Transaction = { ...draft, id: draft.id ?? createId(), updatedAt: new Date().toISOString(), syncStatus: 'pending' };
    await this.transactions.setItem(transaction.id, transaction);
    return transaction;
  }
  async deleteTransaction(id: string): Promise<void> { await this.transactions.removeItem(id); }
  async listInvestmentTrades(): Promise<InvestmentTrade[]> { return this.listStore<InvestmentTrade>(this.investmentTrades); }
  async saveInvestmentTrade(trade: Omit<InvestmentTrade, 'updatedAt'>): Promise<InvestmentTrade> { const stamped: InvestmentTrade = { ...trade, updatedAt: new Date().toISOString() }; await this.investmentTrades.setItem(stamped.id, stamped); return stamped; }

  async listAccounts(): Promise<Account[]> { return this.listStore<Account>(this.accounts); }
  async listTags(): Promise<Tag[]> { return this.listStore<Tag>(this.tags); }
  async listSections(): Promise<TagSection[]> { return this.listStore<TagSection>(this.sections); }
  async listTrips(): Promise<Trip[]> { return this.listStore<Trip>(this.trips); }
  async saveAccount(account: Omit<Account, 'updatedAt'>): Promise<Account> { const stamped: Account = { ...account, updatedAt: new Date().toISOString() }; await this.accounts.setItem(stamped.id, stamped); return stamped; }
  async saveTag(tag: Omit<Tag, 'updatedAt'>): Promise<Tag> { const stamped: Tag = { ...tag, updatedAt: new Date().toISOString() }; await this.tags.setItem(stamped.id, stamped); return stamped; }
  async saveSection(section: Omit<TagSection, 'updatedAt'>): Promise<TagSection> { const stamped: TagSection = { ...section, updatedAt: new Date().toISOString() }; await this.sections.setItem(stamped.id, stamped); return stamped; }
  async saveTrip(trip: Omit<Trip, 'updatedAt'>): Promise<Trip> { const stamped: Trip = { ...trip, updatedAt: new Date().toISOString() }; await this.trips.setItem(stamped.id, stamped); return stamped; }
  async deleteTag(id: string): Promise<void> { await this.tags.removeItem(id); }

  async applyAutoTags(force = false): Promise<void> {
    const tags = await this.listTags();
    const transactions = await this.listTransactions();
    await Promise.all(transactions.filter((transaction) => !transaction.manuallyTagged).map((transaction) => {
      const match = tags.find((tag) => tag.autoTagTerms.some((term) => transaction.merchant.toLowerCase().includes(term.toLowerCase())));
      return force || !transaction.tagId ? this.saveTransaction({ ...transaction, tagId: match?.id }) : Promise.resolve();
    }));
  }

  /** Full local snapshot of every synced entity type, keyed as sent to/received from the backend. */
  async snapshot(): Promise<SyncEntities> {
    const [accounts, tags, sections, trips, transactions, investmentTrades] = await Promise.all([
      this.listAccounts(), this.listTags(), this.listSections(), this.listTrips(), this.listTransactions(), this.listInvestmentTrades(),
    ]);
    return { accounts, tags, sections, trips, transactions, investmentTrades };
  }

  /** Overwrites local records with the server's reconciled state (server already merged by updatedAt). */
  async applyRemoteSnapshot(entities: Partial<SyncEntities>): Promise<void> {
    await Promise.all([
      ...(entities.accounts ?? []).map((account) => this.accounts.setItem(account.id, account)),
      ...(entities.tags ?? []).map((tag) => this.tags.setItem(tag.id, tag)),
      ...(entities.sections ?? []).map((section) => this.sections.setItem(section.id, section)),
      ...(entities.trips ?? []).map((trip) => this.trips.setItem(trip.id, trip)),
      ...(entities.transactions ?? []).map((transaction) => this.transactions.setItem(transaction.id, { ...transaction, syncStatus: 'synced' as const })),
      ...(entities.investmentTrades ?? []).map((trade) => this.investmentTrades.setItem(trade.id, trade)),
    ]);
  }

  private async listStore<T>(store: ReturnType<typeof localforage.createInstance>): Promise<T[]> {
    const result: T[] = [];
    await store.iterate<T, void>((value: T) => { result.push(value); });
    return result;
  }
}