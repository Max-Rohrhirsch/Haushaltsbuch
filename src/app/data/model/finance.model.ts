export type FinanceContext = 'home' | 'travel';

export interface Account {
  id: string;
  name: string;
  listed: boolean;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  sectionId?: string;
  parentTagId?: string;
  autoTagTerms: string[];
  favorite?: boolean;
  updatedAt: string;
}

export interface TagSection {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  updatedAt: string;
}

export interface Trip {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  budget: number;
  updatedAt: string;
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
  cashflowType?: 'income' | 'expense' | 'transfer';
}

export interface InvestmentTrade {
  id: string;
  bookingDate: string;
  type: 'Buy' | 'Sell';
  merchant: string;
  isin: string;
  shares: number;
  value: number;
  fees: number;
  taxes: number;
  updatedAt: string;
}