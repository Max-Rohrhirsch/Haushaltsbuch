import { Injectable } from '@angular/core';
import localforage from 'localforage';
import { Account, FinanceContext, InvestmentTrade, Tag, TagSection, Transaction, Trip } from '../model/finance.model';

@Injectable({ providedIn: 'root' })
export class FinanceRepository {
  private readonly transactions = localforage.createInstance({ name: 'finanzbuch', storeName: 'transactions' });
  private readonly accounts = localforage.createInstance({ name: 'finanzbuch', storeName: 'accounts' });
  private readonly tags = localforage.createInstance({ name: 'finanzbuch', storeName: 'tags' });
  private readonly sections = localforage.createInstance({ name: 'finanzbuch', storeName: 'tag_sections' });
  private readonly trips = localforage.createInstance({ name: 'finanzbuch', storeName: 'trips' });
  private readonly investmentTrades = localforage.createInstance({ name: 'finanzbuch', storeName: 'investment_trades' });

  async seed(): Promise<void> {
    const sections: TagSection[] = [
      { id: 'income-section', name: 'Einnahmen', kind: 'income' },
      { id: 'fixed-section', name: 'Fixe Ausgaben', kind: 'expense' },
      { id: 'variable-section', name: 'Variable Ausgaben', kind: 'expense' },
    ];
    await Promise.all(sections.map((section) => this.sections.setItem(section.id, section)));
    if (await this.accounts.length()) {
      const existingTags = await this.listTags();
      await Promise.all(existingTags.filter((tag) => !tag.sectionId).map((tag) => this.saveTag({
        ...tag,
        sectionId: tag.id === 'income' ? 'income-section' : tag.id === 'rent' ? 'fixed-section' : 'variable-section',
      })));
      return;
    }
    const accounts: Account[] = [
      { id: 'tr', name: 'Trade Republic', listed: true },
      { id: 'giro', name: 'Girokonto', listed: true },
      { id: 'cash', name: 'Bargeld', listed: false },
    ];
    const tags: Tag[] = [
      { id: 'income', name: 'Netto Gehalt', sectionId: 'income-section', autoTagTerms: ['gehalt', 'salary'] },
      { id: 'rent', name: 'Miete', sectionId: 'fixed-section', autoTagTerms: ['vermieter', 'miete'] },
      { id: 'food', name: 'Lebensmittel', sectionId: 'variable-section', autoTagTerms: ['rewe', 'edeka', 'lidl', 'restaurant'] },
      { id: 'travel', name: 'Reisen', sectionId: 'variable-section', autoTagTerms: ['airbnb', 'booking', 'bahn'] },
    ];
    const trips: Trip[] = [{ id: 'portugal-2026', name: 'Portugal 2026', startDate: '2026-09-01', endDate: '2026-10-15', budget: 4500 }];
    const transactions: Transaction[] = [
      { id: 'seed-1', context: 'home', bookingDate: '2026-08-01', merchant: 'Gehalt', amount: 3200, currency: 'EUR', exchangeRateToEur: 1, amountEur: 3200, accountId: 'giro', tagId: 'income', manuallyTagged: false, updatedAt: '2026-08-01T08:00:00Z', syncStatus: 'pending' },
      { id: 'seed-2', context: 'home', bookingDate: '2026-08-03', merchant: 'Vermieter', amount: -980, currency: 'EUR', exchangeRateToEur: 1, amountEur: -980, accountId: 'giro', tagId: 'rent', manuallyTagged: false, updatedAt: '2026-08-03T08:00:00Z', syncStatus: 'pending' },
      { id: 'seed-3', context: 'home', bookingDate: '2026-08-06', merchant: 'REWE', amount: -67.40, currency: 'EUR', exchangeRateToEur: 1, amountEur: -67.40, accountId: 'giro', tagId: 'food', manuallyTagged: false, updatedAt: '2026-08-06T17:00:00Z', syncStatus: 'pending' },
      { id: 'seed-4', context: 'travel', bookingDate: '2026-09-04', merchant: 'Airbnb Lisboa', amount: -360, currency: 'EUR', exchangeRateToEur: 1, amountEur: -360, accountId: 'tr', tagId: 'travel', manuallyTagged: false, tripId: 'portugal-2026', countryCode: 'PT', updatedAt: '2026-09-04T12:00:00Z', syncStatus: 'pending' },
    ];
    await Promise.all([
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
    const transaction: Transaction = { ...draft, id: draft.id ?? crypto.randomUUID(), updatedAt: new Date().toISOString(), syncStatus: 'pending' };
    await this.transactions.setItem(transaction.id, transaction);
    return transaction;
  }
  async deleteTransaction(id: string): Promise<void> { await this.transactions.removeItem(id); }
  async listInvestmentTrades(): Promise<InvestmentTrade[]> { return this.listStore<InvestmentTrade>(this.investmentTrades); }
  async saveInvestmentTrade(trade: InvestmentTrade): Promise<void> { await this.investmentTrades.setItem(trade.id, trade); }

  async listAccounts(): Promise<Account[]> { return this.listStore<Account>(this.accounts); }
  async listTags(): Promise<Tag[]> { return this.listStore<Tag>(this.tags); }
  async listSections(): Promise<TagSection[]> { return this.listStore<TagSection>(this.sections); }
  async listTrips(): Promise<Trip[]> { return this.listStore<Trip>(this.trips); }
  async saveAccount(account: Account): Promise<void> { await this.accounts.setItem(account.id, account); }
  async saveTag(tag: Tag): Promise<void> { await this.tags.setItem(tag.id, tag); }
  async saveSection(section: TagSection): Promise<void> { await this.sections.setItem(section.id, section); }
  async saveTrip(trip: Trip): Promise<void> { await this.trips.setItem(trip.id, trip); }
  async deleteTag(id: string): Promise<void> { await this.tags.removeItem(id); }

  async applyAutoTags(force = false): Promise<void> {
    const tags = await this.listTags();
    const transactions = await this.listTransactions();
    await Promise.all(transactions.filter((transaction) => !transaction.manuallyTagged).map((transaction) => {
      const match = tags.find((tag) => tag.autoTagTerms.some((term) => transaction.merchant.toLowerCase().includes(term.toLowerCase())));
      return force || !transaction.tagId ? this.saveTransaction({ ...transaction, tagId: match?.id }) : Promise.resolve();
    }));
  }

  private async listStore<T>(store: ReturnType<typeof localforage.createInstance>): Promise<T[]> {
    const result: T[] = [];
    await store.iterate<T, void>((value: T) => { result.push(value); });
    return result;
  }
}