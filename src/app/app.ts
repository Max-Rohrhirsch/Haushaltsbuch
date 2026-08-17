import { AfterViewChecked, Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { use, type ECharts, init } from 'echarts/core';
import { PieChart, SankeyChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { Account, FinanceContext, InvestmentTrade, Tag, TagSection, Transaction, Trip } from './data/model/finance.model';
import { createId } from './data/id';
import { FinanceRepository } from './data/repository/finance.repository';
import { SyncService } from './data/sync.service';

use([SankeyChart, PieChart, TooltipComponent, CanvasRenderer]);

type HomeTab = 'overview' | 'tags' | 'analysis' | 'accounts' | 'import';
type TravelTab = 'overview' | 'analysis';
type TravelScope = 'trip' | 'all';

interface TradeRepublicRow {
  date: string;
  type: string;
  value: number;
  rawValue: number;
  note: string;
  isin: string;
  shares: number;
  fees: number;
  taxes: number;
}

interface AnalysisEntry { id: string; name: string; value: number; favorite?: boolean; }

@Component({ selector: 'app-root', imports: [FormsModule], templateUrl: './app.html', styleUrl: './app.scss' })
export class App implements AfterViewChecked {
  @ViewChild('cashflowChart') private cashflowChartElement?: ElementRef<HTMLDivElement>;
  @ViewChild('pieChart') private pieChartElement?: ElementRef<HTMLDivElement>;
  @ViewChild('pieChartModal') private pieChartModalElement?: ElementRef<HTMLDivElement>;
  private cashflowChart?: ECharts;
  private cashflowChartHost?: HTMLDivElement;
  private cashflowChartReady = false;
  private pieChart?: ECharts;
  private pieChartHost?: HTMLDivElement;
  private pieChartReady = false;
  private pieChartModal?: ECharts;
  protected readonly pieExpanded = signal(false);
  protected readonly openCurrencyPicker = signal<string | null>(null);
  private readonly repository = inject(FinanceRepository);
  protected readonly sync = inject(SyncService);
  protected readonly context = signal<FinanceContext>('home');
  protected readonly homeTab = signal<HomeTab>('overview');
  protected readonly travelTab = signal<TravelTab>('overview');
  protected readonly travelScope = signal<TravelScope>('trip');
  protected readonly year = signal(new Date().getFullYear());
  protected readonly month = signal(new Date().getMonth());
  protected readonly transactions = signal<Transaction[]>([]);
  protected readonly investmentTrades = signal<InvestmentTrade[]>([]);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly tags = signal<Tag[]>([]);
  protected readonly sections = signal<TagSection[]>([]);
  protected readonly trips = signal<Trip[]>([]);
  protected readonly selectedTripId = signal<string | undefined>(undefined);
  protected readonly excludedTagIds = signal<string[]>([]);
  protected readonly months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  private readonly allCurrencies = [{ code: 'EUR', rate: 1 }, { code: 'USD', rate: 0.92 }, { code: 'GBP', rate: 1.17 }, { code: 'JPY', rate: 0.0062 }, { code: 'THB', rate: 0.025 }, { code: 'IDR', rate: 0.000057 }, { code: 'AUD', rate: 0.61 }, { code: 'CAD', rate: 0.67 }, { code: 'CHF', rate: 1.04 }, { code: 'CNY', rate: 0.13 }, { code: 'CZK', rate: 0.039 }, { code: 'DKK', rate: 0.134 }, { code: 'HKD', rate: 0.118 }, { code: 'HUF', rate: 0.00255 }, { code: 'INR', rate: 0.011 }, { code: 'KRW', rate: 0.00068 }, { code: 'MXN', rate: 0.052 }, { code: 'NOK', rate: 0.087 }, { code: 'NZD', rate: 0.56 }, { code: 'PLN', rate: 0.23 }, { code: 'SEK', rate: 0.089 }, { code: 'SGD', rate: 0.68 }, { code: 'TRY', rate: 0.025 }, { code: 'ZAR', rate: 0.05 }];
  protected readonly selectedTrip = computed(() => this.trips().find((trip) => trip.id === this.selectedTripId()));
  protected readonly activeTransactions = computed(() => this.context() === 'travel' && this.travelScope() === 'trip' ? this.transactions().filter((transaction) => transaction.tripId === this.selectedTripId()) : this.transactions());
  protected readonly yearTransactions = computed(() => this.context() === 'travel' ? this.activeTransactions() : this.activeTransactions().filter((transaction) => transaction.bookingDate.startsWith(`${this.year()}-`)));
  protected readonly visibleTransactions = computed(() => this.yearTransactions().filter((transaction) => transaction.bookingDate.startsWith(`${this.year()}-${String(this.month() + 1).padStart(2, '0')}`)));
  protected readonly totalIncome = computed(() => this.yearTransactions().filter((transaction) => this.isIncome(transaction)).reduce((sum, transaction) => sum + transaction.amountEur, 0));
  protected readonly totalExpenses = computed(() => this.yearTransactions().filter((transaction) => this.isExpense(transaction)).reduce((sum, transaction) => sum + transaction.amountEur, 0));
  protected readonly balance = computed(() => this.totalIncome() + this.totalExpenses() + this.investmentResultForYear());
  protected readonly listedBalance = computed(() => this.yearTransactions().filter((transaction) => this.accounts().find((account) => account.id === transaction.accountId)?.listed).reduce((sum, transaction) => sum + transaction.amountEur, 0));
  protected readonly analysisEntries = computed<AnalysisEntry[]>(() => {
    const entries: AnalysisEntry[] = this.tags().filter((tag) => !tag.parentTagId && !this.isExcluded(tag.id)).map((tag) => { const value = this.tagTotal(tag.id); return { id: tag.id, name: `${tag.favorite ? '★ ' : ''}${tag.name}`, value, favorite: tag.favorite }; });
    const untaggedIncome = this.yearTransactions().filter((transaction) => !transaction.tagId && this.isIncome(transaction)).reduce((sum, transaction) => sum + transaction.amountEur, 0);
    const untaggedExpense = this.yearTransactions().filter((transaction) => !transaction.tagId && this.isExpense(transaction)).reduce((sum, transaction) => sum + transaction.amountEur, 0);
    if (untaggedIncome) entries.push({ id: 'other-income', name: 'Sonstiges', value: untaggedIncome });
    if (untaggedExpense) entries.push({ id: 'other-expense', name: 'Sonstiges', value: untaggedExpense });
    if (this.context() === 'home' && this.investmentResultForYear() !== 0 && !this.isExcluded('investment-result')) entries.push({ id: 'investment-result', name: 'Aktiengewinne/-verluste', value: this.investmentResultForYear() });
    return entries.filter((entry) => Math.abs(entry.value) >= 0.005).sort((first, second) => Math.abs(second.value) - Math.abs(first.value));
  });
  protected readonly pieEntries = computed(() => this.analysisEntries().filter((entry) => entry.value < 0));
  protected readonly analysisTags = computed(() => this.analysisEntries());
  protected readonly tagName = computed(() => new Map(this.tags().map((tag) => [tag.id, tag.name])));
  protected merchant = '';
  protected amount: number | string | null = null;
  protected transactionSaveError = '';
  protected bookingDate = '';
  protected note = '';
  protected location = '';
  protected currency = 'EUR';
  protected accountId = '';
  protected tagId = '';
  protected newTagName = '';
  protected newTagTerms = '';
  protected newTagParentId = '';
  protected newTagSectionId = '';
  protected newSectionName = '';
  protected newSectionKind: TagSection['kind'] = 'expense';
  protected newAccountName = '';
  protected newTripName = '';
  protected newTripBudget: number | null = null;
  protected tradeRepublicCsv = '';
  protected tradeRepublicFileName = '';
  protected readonly tradeRepublicRows = signal<TradeRepublicRow[]>([]);
  protected importStatus = '';
  protected currencyQuery = '';
  protected forceAutoTagging = false;
  private recentCurrencyCodes = ['EUR', 'USD'];
  protected get currencies(): { code: string; rate: number }[] { return this.allCurrencies.filter((entry) => entry.code.toLowerCase().includes(this.currencyQuery.toLowerCase())).sort((first, second) => (this.recentCurrencyCodes.indexOf(first.code) + 1 || 999) - (this.recentCurrencyCodes.indexOf(second.code) + 1 || 999)); }

  constructor() { void this.initialize(); }

  protected async switchContext(context: FinanceContext): Promise<void> { this.context.set(context); await this.loadTransactions(); }
  protected changeMonth(delta: number): void { const date = new Date(this.year(), this.month() + delta, 1); this.year.set(date.getFullYear()); this.month.set(date.getMonth()); }
  protected changeYear(delta: number): void { this.year.update((year) => year + delta); }
  protected async selectTrip(id: string | undefined): Promise<void> { this.selectedTripId.set(id); await this.loadTransactions(); }
  protected tagsInSection(sectionId: string): Tag[] { return this.tags().filter((tag) => tag.sectionId === sectionId); }
  protected unassignedTags(): Tag[] { return this.tags().filter((tag) => !tag.sectionId); }
  protected sectionTotal(sectionId: string): number { return this.tagsInSection(sectionId).reduce((sum, tag) => sum + this.yearTotal(tag.id), 0); }
  protected monthTotal(kind: 'income' | 'expense', month: number): number { return this.yearTransactions().filter((transaction) => transaction.bookingDate.startsWith(`${this.year()}-${String(month + 1).padStart(2, '0')}`) && (kind === 'income' ? this.isIncome(transaction) : this.isExpense(transaction))).reduce((sum, transaction) => sum + transaction.amountEur, 0); }
  protected monthInvestmentResult(month: number): number { return this.realizedInvestmentResults().filter((entry) => entry.date.startsWith(`${this.year()}-${String(month + 1).padStart(2, '0')}`)).reduce((sum, entry) => sum + entry.value, 0); }
  protected monthBalance(month: number): number { return this.monthTotal('income', month) + this.monthTotal('expense', month) + this.monthInvestmentResult(month); }
  protected cellTotal(tagId: string, month: number): number { return this.yearTransactions().filter((transaction) => transaction.tagId === tagId && transaction.bookingDate.startsWith(`${this.year()}-${String(month + 1).padStart(2, '0')}`)).reduce((sum, transaction) => sum + transaction.amountEur, 0); }
  protected yearTotal(tagId: string): number { if (tagId === 'investment-result') return this.investmentResultForYear(); if (tagId === 'other-income') return this.yearTransactions().filter((transaction) => !transaction.tagId && this.isIncome(transaction)).reduce((sum, transaction) => sum + transaction.amountEur, 0); if (tagId === 'other-expense') return this.yearTransactions().filter((transaction) => !transaction.tagId && this.isExpense(transaction)).reduce((sum, transaction) => sum + transaction.amountEur, 0); return this.yearTransactions().filter((transaction) => transaction.tagId === tagId && (this.isIncome(transaction) || this.isExpense(transaction))).reduce((sum, transaction) => sum + transaction.amountEur, 0); }
  protected childTags(parentId: string): Tag[] { return this.tags().filter((tag) => tag.parentTagId === parentId && !this.isExcluded(tag.id)); }
  protected directChildTags(parentId: string): Tag[] { return this.tags().filter((tag) => tag.parentTagId === parentId); }
  protected tagTotal(tagId: string): number { return this.directChildTags(tagId).reduce((sum, child) => sum + this.tagTotal(child.id), this.yearTotal(tagId)); }
  protected tagCellTotal(tagId: string, month: number): number { return this.directChildTags(tagId).reduce((sum, child) => sum + this.tagCellTotal(child.id, month), this.cellTotal(tagId, month)); }
  protected sectionTags(section: TagSection): Tag[] { return this.tagsInSection(section.id).filter((tag) => !tag.parentTagId && !this.isExcluded(tag.id)); }
  protected chartWidth(tagId: string): number { return Math.min(100, Math.abs(this.tagTotal(tagId)) / Math.max(1, Math.abs(this.totalExpenses())) * 100); }
  protected isExcluded(tagId: string): boolean { return this.excludedTagIds().includes(tagId); }
  protected toggleAnalysisTag(tagId: string): void { this.excludedTagIds.update((ids) => ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId]); this.cashflowChartReady = false; this.pieChartReady = false; }
  protected async toggleFavorite(tag: Tag): Promise<void> { tag.favorite = !tag.favorite; await this.updateTag(tag); }
  protected signedAmount(value: number): string { return `${value >= 0 ? '+' : '-'}${this.formatAmount(Math.abs(value))}`; }
  protected useCurrency(code: string): void { this.currency = code; this.recentCurrencyCodes = [code, ...this.recentCurrencyCodes.filter((entry) => entry !== code)].slice(0, 4); this.currencyQuery = ''; }
  protected recentCurrencyEntries(): { code: string; rate: number }[] { return this.recentCurrencyCodes.map((code) => this.allCurrencies.find((entry) => entry.code === code)).filter((entry): entry is { code: string; rate: number } => Boolean(entry)).filter((entry) => entry.code.toLowerCase().includes(this.currencyQuery.toLowerCase())); }
  protected remainingCurrencyEntries(): { code: string; rate: number }[] { return this.allCurrencies.filter((entry) => !this.recentCurrencyCodes.includes(entry.code)).filter((entry) => entry.code.toLowerCase().includes(this.currencyQuery.toLowerCase())).sort((first, second) => first.code.localeCompare(second.code)); }
  protected toggleCurrencyPicker(id: string): void { this.currencyQuery = ''; this.openCurrencyPicker.update((current) => current === id ? null : id); }
  protected closeCurrencyPicker(): void { this.openCurrencyPicker.set(null); }
  protected async selectTransactionCurrency(transaction: Transaction, code: string): Promise<void> { transaction.currency = code; transaction.exchangeRateToEur = this.allCurrencies.find((entry) => entry.code === code)?.rate ?? 1; this.recentCurrencyCodes = [code, ...this.recentCurrencyCodes.filter((entry) => entry !== code)].slice(0, 4); this.closeCurrencyPicker(); await this.updateTransaction(transaction); }
  protected isIncome(transaction: Transaction): boolean { return transaction.amountEur > 0; }
  protected isExpense(transaction: Transaction): boolean { return transaction.amountEur < 0; }
  protected investmentResultForYear(): number { return this.realizedInvestmentResults().filter((entry) => entry.date.startsWith(`${this.year()}-`)).reduce((sum, entry) => sum + entry.value, 0); }

  ngAfterViewChecked(): void {
    this.enableSignedAmountInputs();
    const homeAnalysisActive = this.context() === 'home' && this.homeTab() === 'analysis';
    const travelAnalysisActive = this.context() === 'travel' && this.travelTab() === 'analysis';
    if (homeAnalysisActive && this.cashflowChartElement && (!this.cashflowChartReady || this.cashflowChartHost !== this.cashflowChartElement.nativeElement)) {
      this.renderCashflowChart();
    }
    if ((homeAnalysisActive || travelAnalysisActive) && this.pieChartElement && (!this.pieChartReady || this.pieChartHost !== this.pieChartElement.nativeElement)) {
      this.renderPieChart();
    }
    if (this.pieExpanded() && this.pieChartModalElement) {
      this.renderPieChart(true);
    }
  }

  protected async saveTransaction(): Promise<void> {
    this.transactionSaveError = '';
    if (!this.merchant.trim()) { this.showTransactionSaveError('Bitte eine Beschreibung eingeben.'); return; }
    const amount = this.parseAmount(this.amount);
    if (amount === null || amount === 0) { this.showTransactionSaveError('Bitte einen Betrag ungleich 0 eingeben.'); return; }
    if (!this.accountId) { this.showTransactionSaveError('Bitte ein Konto auswählen.'); return; }
    if (this.context() === 'travel' && !this.selectedTripId()) { this.showTransactionSaveError('Bitte zuerst eine Reise auswählen.'); return; }
    const rate = this.currencies.find((entry) => entry.code === this.currency)?.rate ?? 1;
    await this.repository.saveTransaction({ context: this.context(), bookingDate: this.bookingDate || `${this.year()}-${String(this.month() + 1).padStart(2, '0')}-01`, merchant: this.merchant.trim(), amount, currency: this.currency, exchangeRateToEur: rate, amountEur: amount * rate, accountId: this.accountId, tagId: this.tagId || undefined, note: this.note.trim() || undefined, location: this.location.trim() || undefined, manuallyTagged: Boolean(this.tagId), tripId: this.context() === 'travel' ? this.selectedTripId() : undefined });
    this.useCurrency(this.currency); this.merchant = ''; this.amount = null; this.bookingDate = ''; this.note = ''; this.location = ''; this.tagId = ''; this.currency = 'EUR';
    await this.loadTransactions();
  }

  protected async updateTransaction(transaction: Transaction): Promise<void> { transaction.amountEur = transaction.amount * transaction.exchangeRateToEur; await this.repository.saveTransaction(transaction); await this.loadTransactions(); }
  private showTransactionSaveError(message: string): void { this.transactionSaveError = message; window.alert(message); }
  private parseAmount(value: number | string | null): number | null { const parsed = typeof value === 'number' ? value : Number(value?.trim().replace(',', '.')); return Number.isFinite(parsed) ? parsed : null; }
  private enableSignedAmountInputs(): void { if (typeof document === 'undefined') return; document.querySelectorAll<HTMLInputElement>('input[name="amount"], input[name="travelAmount"]').forEach((input) => { input.type = 'text'; input.inputMode = 'text'; }); }
  protected async deleteTransaction(transaction: Transaction): Promise<void> { await this.repository.deleteTransaction(transaction.id); await this.loadTransactions(); }
  protected async updateTagTerms(tag: Tag, terms: string): Promise<void> { tag.autoTagTerms = terms.split(',').map((term) => term.trim()).filter((term) => Boolean(term)); await this.updateTag(tag); }
  protected async addTag(): Promise<void> { if (!this.newTagName.trim()) return; await this.repository.saveTag({ id: createId(), name: this.newTagName.trim(), sectionId: this.newTagSectionId || undefined, parentTagId: this.newTagParentId || undefined, autoTagTerms: this.newTagTerms.split(',').map((term) => term.trim()).filter(Boolean) }); this.newTagName = ''; this.newTagTerms = ''; this.newTagParentId = ''; await this.loadData(); }
  protected async updateTag(tag: Tag): Promise<void> { await this.repository.saveTag(tag); await this.loadData(); }
  protected async deleteTag(id: string): Promise<void> { await this.repository.deleteTag(id); await this.loadData(); }
  protected async addSection(): Promise<void> { if (!this.newSectionName.trim()) return; await this.repository.saveSection({ id: createId(), name: this.newSectionName.trim(), kind: this.newSectionKind }); this.newSectionName = ''; await this.loadData(); }
  protected async runAutoTagging(): Promise<void> { await this.repository.applyAutoTags(this.forceAutoTagging); await this.loadTransactions(); }
  protected async addAccount(): Promise<void> { if (!this.newAccountName.trim()) return; await this.repository.saveAccount({ id: createId(), name: this.newAccountName.trim(), listed: true }); this.newAccountName = ''; await this.loadData(); }
  protected async updateAccount(account: Account): Promise<void> { await this.repository.saveAccount(account); await this.loadData(); }
  protected async importTradeRepublic(): Promise<void> {
    const rows = this.tradeRepublicRows();
    if (!rows.length) { this.importStatus = 'Keine gültigen Buchungen gefunden.'; return; }
    let account = this.accounts().find((entry) => entry.name.toLowerCase() === 'trade republic');
    if (!account) { account = await this.repository.saveAccount({ id: createId(), name: 'Trade Republic', listed: true }); await this.loadData(); }
    const existingTransactions = new Set((await this.repository.listTransactions('home')).map((transaction) => transaction.id));
    const existingTrades = new Set((await this.repository.listInvestmentTrades()).map((trade) => trade.id));
    const pendingWrites: Promise<unknown>[] = [];
    let imported = 0;
    for (const row of rows) {
      const id = this.tradeRepublicId(row);
      if (row.type === 'Buy' || row.type === 'Sell') {
        if (existingTrades.has(id) || !row.isin || !row.shares) continue;
        pendingWrites.push(this.repository.saveInvestmentTrade({ id, bookingDate: row.date, type: row.type, merchant: row.note || row.type, isin: row.isin, shares: row.shares, value: row.rawValue, fees: row.fees, taxes: row.taxes }));
      } else {
        if (existingTransactions.has(id)) continue;
        const amount = row.value;
        pendingWrites.push(this.repository.saveTransaction({ id, context: 'home', bookingDate: row.date, merchant: row.note || row.type, amount, currency: 'EUR', exchangeRateToEur: 1, amountEur: amount, accountId: account.id, manuallyTagged: false, cashflowType: row.type === 'Deposit' ? 'transfer' : amount >= 0 ? 'income' : 'expense', note: `Trade Republic · ${row.type}` }));
      }
      imported++;
    }
    await Promise.all(pendingWrites);
    this.importStatus = `${imported} Buchungen importiert${imported < rows.length ? `, ${rows.length - imported} bereits vorhanden` : ''}.`;
    await this.loadData();
    await this.loadTransactions();
  }
  protected async selectTradeRepublicFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.tradeRepublicFileName = file.name;
    this.tradeRepublicCsv = await file.text();
    this.tradeRepublicRows.set(this.parseTradeRepublicCsv(this.tradeRepublicCsv));
    this.importStatus = `${this.tradeRepublicRows().length} Buchungen erkannt aus ${file.name}.`;
  }
  protected tradeRepublicPreview(): TradeRepublicRow[] { return this.tradeRepublicRows().slice(0, 8); }
  protected async addTrip(): Promise<void> { if (!this.newTripName.trim() || !this.newTripBudget) return; const id = createId(); await this.repository.saveTrip({ id, name: this.newTripName.trim(), startDate: `${this.year()}-01-01`, endDate: `${this.year()}-12-31`, budget: this.newTripBudget }); this.newTripName = ''; this.newTripBudget = null; this.selectedTripId.set(id); await this.loadData(); await this.loadTransactions(); }
  protected async updateTrip(trip: Trip): Promise<void> { await this.repository.saveTrip(trip); await this.loadData(); }
  protected tripExpenses(tripId: string): number { return this.transactions().filter((transaction) => transaction.tripId === tripId && transaction.amountEur < 0).reduce((sum, transaction) => sum + transaction.amountEur, 0); }
  protected tripProgress(trip: Trip): number { return Math.min(100, Math.abs(this.tripExpenses(trip.id)) / Math.max(1, trip.budget) * 100); }
  protected formatAmount(value: number, currency = 'EUR'): string { return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(Math.abs(value) < 0.005 ? 0 : value); }

  private renderCashflowChart(): void {
    const element = this.cashflowChartElement?.nativeElement;
    if (!element) return;
    if (this.cashflowChartHost !== element) {
      this.cashflowChart?.dispose();
      this.cashflowChart = undefined;
      this.cashflowChartHost = element;
    }
    this.cashflowChart ??= init(element);
    const nodes: { name: string }[] = [];
    const labels = new Map<string, string>();
    const links: { source: string; target: string; value: number }[] = [];
    const addNode = (name: string, label = name): void => { if (!nodes.some((node) => node.name === name)) nodes.push({ name }); labels.set(name, label); };
    const budgetNode = 'Gesamtbudget';
    addNode(budgetNode, 'Gesamtbudget');
    const incomeOther = this.yearTransactions().filter((transaction) => !transaction.tagId && this.isIncome(transaction)).reduce((sum, transaction) => sum + transaction.amountEur, 0);
    const expenseOther = this.yearTransactions().filter((transaction) => !transaction.tagId && this.isExpense(transaction)).reduce((sum, transaction) => sum + transaction.amountEur, 0);
    if (incomeOther) { addNode('income-other', 'Sonstiges'); links.push({ source: 'income-other', target: budgetNode, value: incomeOther }); }
    if (expenseOther) { addNode('expense-other', 'Sonstiges'); links.push({ source: budgetNode, target: 'expense-other', value: Math.abs(expenseOther) }); }
    for (const section of this.sections()) {
      const sectionValue = Math.abs(this.sectionTotal(section.id));
      if (!sectionValue) continue;
      const sectionNode = `${section.kind}-${section.id}`;
      addNode(sectionNode, section.name);
      if (section.kind === 'income') links.push({ source: sectionNode, target: budgetNode, value: sectionValue });
      else links.push({ source: budgetNode, target: sectionNode, value: sectionValue });
      for (const tag of this.sectionTags(section)) {
        const tagValue = Math.abs(this.yearTotal(tag.id));
        if (!tagValue) continue;
        const tagNode = `${sectionNode}-${tag.id}`;
        addNode(tagNode, tag.name);
        if (section.kind === 'income') links.push({ source: tagNode, target: sectionNode, value: tagValue });
        else links.push({ source: sectionNode, target: tagNode, value: tagValue });
        for (const child of this.childTags(tag.id)) {
          const childValue = Math.abs(this.yearTotal(child.id));
          if (!childValue) continue;
          const childNode = `${tagNode}-${child.id}`;
          addNode(childNode, child.name);
          if (section.kind === 'income') links.push({ source: childNode, target: tagNode, value: childValue });
          else links.push({ source: tagNode, target: childNode, value: childValue });
        }
      }
    }
    this.cashflowChart.setOption({ animationDuration: 700, tooltip: { trigger: 'item', formatter: (params: { name: string; value: number }) => `${labels.get(params.name) ?? params.name}: ${this.formatAmount(params.value)}` }, series: [{ type: 'sankey', left: '4%', right: '16%', top: 16, bottom: 16, nodeWidth: 14, nodeAlign: 'justify', nodeGap: 18, draggable: true, emphasis: { focus: 'adjacency' }, data: nodes, links, label: { color: '#112d4b', fontSize: 11, overflow: 'truncate', width: 130, formatter: (params: { name: string }) => labels.get(params.name) ?? params.name }, lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.42 }, itemStyle: { borderColor: '#fff', borderWidth: 1 } }] });
    this.cashflowChart.resize();
    this.cashflowChartReady = true;
  }

  private renderPieChart(forModal = false): void {
    const element = forModal ? this.pieChartModalElement?.nativeElement : this.pieChartElement?.nativeElement;
    if (!element) return;
    if (forModal) {
      this.pieChartModal?.dispose();
      this.pieChartModal = init(element);
    } else {
      if (this.pieChartHost !== element) {
        this.pieChart?.dispose();
        this.pieChart = undefined;
        this.pieChartHost = element;
      }
      this.pieChart ??= init(element);
    }
    const chart = forModal ? this.pieChartModal! : this.pieChart!;
    const colors = ['#f20d5d', '#112d4b', '#4f87b9', '#f5a623', '#16845a', '#8c5bb3', '#2f9e8f', '#c2410c'];
    const data = this.pieEntries().map((entry, index) => ({ id: entry.id, name: entry.name, value: Math.abs(entry.value), itemStyle: { color: colors[index % colors.length] } }));
    chart.setOption({
      tooltip: { trigger: 'item', formatter: (params: { name: string; value: number; percent: number }) => `${params.name}: ${this.formatAmount(params.value)} (${params.percent}%)` },
      series: [{
        type: 'pie',
        radius: forModal ? ['42%', '72%'] : ['46%', '76%'],
        center: ['50%', '50%'],
        data,
        avoidLabelOverlap: true,
        label: { formatter: '{b}\n{d}%', color: '#112d4b', fontSize: forModal ? 13 : 10, overflow: 'truncate' },
        labelLine: { length: 6, length2: 6 },
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        emphasis: { scaleSize: 6 }
      }]
    });
    chart.off('click');
    chart.on('click', (params: unknown) => { const id = (params as { data?: { id?: string } }).data?.id; if (id) this.toggleAnalysisTag(id); });
    chart.resize();
    if (!forModal) this.pieChartReady = true;
  }

  protected togglePieExpanded(): void {
    this.pieExpanded.update((value) => !value);
    if (!this.pieExpanded()) { this.pieChartModal?.dispose(); this.pieChartModal = undefined; }
  }

  private async initialize(): Promise<void> { await this.repository.seed(); await this.loadData(); this.accountId = this.accounts()[0]?.id ?? ''; this.selectedTripId.set(this.trips()[0]?.id); await this.loadTransactions(); this.sync.init(() => { void this.refreshFromSync(); }); }
  private async loadData(): Promise<void> { const [accounts, tags, sections, trips, investmentTrades] = await Promise.all([this.repository.listAccounts(), this.repository.listTags(), this.repository.listSections(), this.repository.listTrips(), this.repository.listInvestmentTrades()]); this.accounts.set(accounts); this.tags.set(tags); this.sections.set(sections); this.trips.set(trips); this.investmentTrades.set(investmentTrades); this.sync.notifyChange(); }
  private async loadTransactions(): Promise<void> { this.transactions.set(await this.repository.listTransactions(this.context())); this.sync.notifyChange(); }
  private async refreshFromSync(): Promise<void> { const [accounts, tags, sections, trips, investmentTrades, transactions] = await Promise.all([this.repository.listAccounts(), this.repository.listTags(), this.repository.listSections(), this.repository.listTrips(), this.repository.listInvestmentTrades(), this.repository.listTransactions(this.context())]); this.accounts.set(accounts); this.tags.set(tags); this.sections.set(sections); this.trips.set(trips); this.investmentTrades.set(investmentTrades); this.transactions.set(transactions); }
  private parseTradeRepublicCsv(csv: string): TradeRepublicRow[] {
    const lines = csv.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) return [];
    return lines.slice(1).map((line) => this.parseDelimitedLine(line)).map((columns) => {
      const rawValue = Number((columns[2] ?? '').replace(',', '.')) || 0;
      const fees = Number((columns[6] ?? '').replace(',', '.')) || 0;
      const taxes = Number((columns[7] ?? '').replace(',', '.')) || 0;
      const value = rawValue + fees - Math.abs(taxes);
      const type = columns[1] ?? '';
      const signedValue = ['Buy', 'Removal', 'Taxes'].includes(type) ? -Math.abs(value) : Math.abs(value);
      return { date: (columns[0] ?? '').slice(0, 10), type, value: signedValue, rawValue, note: columns[3] ?? '', isin: columns[4] ?? '', shares: Number((columns[5] ?? '').replace(',', '.')) || 0, fees, taxes: Math.abs(taxes) };
    }).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.type && row.value !== 0);
  }
  private parseDelimitedLine(line: string): string[] {
    const columns: string[] = []; let value = ''; let quoted = false;
    for (const character of line) {
      if (character === '"') quoted = !quoted;
      else if (character === ';' && !quoted) { columns.push(value); value = ''; }
      else value += character;
    }
    columns.push(value);
    return columns;
  }
  private tradeRepublicId(row: TradeRepublicRow): string { let hash = 2166136261; for (const character of `${row.date}|${row.type}|${row.rawValue}|${row.note}|${row.isin}|${row.shares}|${row.fees}|${row.taxes}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619); return `tr-import-${(hash >>> 0).toString(16)}`; }
  private isExcludedTradeCashflow(transaction: Transaction): boolean { return transaction.cashflowType === 'transfer' || transaction.note?.startsWith('Trade Republic · Deposit') === true || transaction.note?.startsWith('Trade Republic · Buy') === true || transaction.note?.startsWith('Trade Republic · Sell') === true; }
  private realizedInvestmentResults(): { date: string; value: number }[] {
    const holdings = new Map<string, { shares: number; cost: number }>();
    const results: { date: string; value: number }[] = [];
    const trades = [...this.investmentTrades()].sort((first, second) => `${first.bookingDate}|${first.id}`.localeCompare(`${second.bookingDate}|${second.id}`));
    for (const trade of trades) {
      const current = holdings.get(trade.isin) ?? { shares: 0, cost: 0 };
      if (trade.type === 'Buy') {
        current.shares += trade.shares;
        current.cost += Math.abs(trade.value) + Math.abs(trade.fees) + Math.abs(trade.taxes);
      } else {
        const averageCost = current.shares > 0 ? current.cost / current.shares : 0;
        const soldShares = Math.min(trade.shares, current.shares);
        const proceeds = trade.value + trade.fees - Math.abs(trade.taxes);
        const realized = proceeds - averageCost * soldShares;
        current.shares = Math.max(0, current.shares - trade.shares);
        current.cost = Math.max(0, current.cost - averageCost * soldShares);
        results.push({ date: trade.bookingDate, value: realized });
      }
      holdings.set(trade.isin, current);
    }
    return results;
  }
}