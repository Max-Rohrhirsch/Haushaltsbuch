export type FinanceContext = 'home' | 'travel';

export interface Account {
  id: string;
  name: string;
  listed: boolean;
}

export interface Tag {
  id: string;
  name: string;
  sectionId?: string;
  parentTagId?: string;
  autoTagTerms: string[];
}

export interface TagSection {
  id: string;
  name: string;
  kind: 'income' | 'expense';
}

export interface Trip {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  budget: number;
}

export interface Transaction {
  id: string;
  context: FinanceContext;
  bookingDate: string;
  merchant: string;
  amount: number;
  currency: string;
  exchangeRateToEur: number;
  amountEur: number;
  accountId: string;
  tagId?: string;
  note?: string;
  location?: string;
  manuallyTagged: boolean;
  countryCode?: string;
  tripId?: string;
  updatedAt: string;
  syncStatus: 'pending' | 'synced';
}