import { AfterViewChecked, Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { use, type ECharts, init } from 'echarts/core';
import { SankeyChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { Account, FinanceContext, Tag, TagSection, Transaction, Trip } from './data/model/finance.model';
import { FinanceRepository } from './data/repository/finance.repository';

use([SankeyChart, TooltipComponent, CanvasRenderer]);

type HomeTab = 'overview' | 'tags' | 'analysis' | 'accounts' | 'import';
type TravelTab = 'overview' | 'analysis';
type TravelScope = 'trip' | 'all';

interface TradeRepublicRow {
  date: string;
  type: string;
  value: number;
  note: string;
}

@Component({ selector: 'app-root', imports: [FormsModule], templateUrl: './app.html', styleUrl: './app.scss' })
export class App implements AfterViewChecked {
  @ViewChild('cashflowChart') private cashflowChartElement?: ElementRef<HTMLDivElement>;
  private cashflowChart?: ECharts;
  private cashflowChartHost?: HTMLDivElement;
  private cashflowChartReady = false;
  private readonly repository = inject(FinanceRepository);
  protected readonly context = signal<FinanceContext>('home');
  protected readonly homeTab = signal<HomeTab>('overview');
  protected readonly travelTab = signal<TravelTab>('overview');
  protected readonly travelScope = signal<TravelScope>('trip');
  protected readonly year = signal(new Date().getFullYear());
  protected readonly month = signal(new Date().getMonth());
  protected readonly transactions = signal<Transaction[]>([]);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly tags = signal<Tag[]>([]);
  protected readonly sections = signal<TagSection[]>([]);
  protected readonly trips = signal<Trip[]>([]);
  protected readonly selectedTripId = signal<string | undefined>(undefined);
  protected readonly excludedTagIds = signal<string[]>([]);
  protected readonly months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  protected readonly currencies = [{ code: 'EUR', rate: 1 }, { code: 'USD', rate: 0.92 }, { code: 'GBP', rate: 1.17 }, { code: 'JPY', rate: 0.0062 }, { code: 'THB', rate: 0.025 }, { code: 'IDR', rate: 0.000057 }];
  protected readonly selectedTrip = computed(() => this.trips().find((trip) => trip.id === this.selectedTripId()));
  protected readonly activeTransactions = computed(() => this.context() === 'travel' && this.travelScope() === 'trip' ? this.transactions().filter((transaction) => transaction.tripId === this.selectedTripId()) : this.transactions());
  protected readonly yearTransactions = computed(() => this.activeTransactions().filter((transaction) => transaction.bookingDate.startsWith(`${this.year()}-`)));
  protected readonly visibleTransactions = computed(() => this.yearTransactions().filter((transaction) => transaction.bookingDate.startsWith(`${this.year()}-${String(this.month() + 1).padStart(2, '0')}`)));
  protected readonly totalIncome = computed(() => this.yearTransactions().filter((transaction) => transaction.amountEur > 0).reduce((sum, transaction) => sum + transaction.amountEur, 0));
  protected readonly totalExpenses = computed(() => this.yearTransactions().filter((transaction) => transaction.amountEur < 0).reduce((sum, transaction) => sum + transaction.amountEur, 0));
  protected readonly balance = computed(() => this.totalIncome() + this.totalExpenses());
  protected readonly listedBalance = computed(() => this.yearTransactions().filter((transaction) => this.accounts().find((account) => account.id === transaction.accountId)?.listed).reduce((sum, transaction) => sum + transaction.amountEur, 0));
  protected readonly analysisTags = computed(() => this.tags().filter((tag) => !tag.parentTagId && !this.isExcluded(tag.id)));
  protected readonly tagName = computed(() => new Map(this.tags().map((tag) => [tag.id, tag.name])));
  protected merchant = '';
  protected amount: number | null = null;
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
  protected importStatus = '';

  constructor() { void this.initialize(); }

  protected async switchContext(context: FinanceContext): Promise<void> { this.context.set(context); await this.loadTransactions(); }
  protected changeMonth(delta: number): void { const date = new Date(this.year(), this.month() + delta, 1); this.year.set(date.getFullYear()); this.month.set(date.getMonth()); }
  protected changeYear(delta: number): void { this.year.update((year) => year + delta); }
  protected async selectTrip(id: string | undefined): Promise<void> { this.selectedTripId.set(id); await this.loadTransactions(); }
  protected tagsInSection(sectionId: string): Tag[] { return this.tags().filter((tag) => tag.sectionId === sectionId); }
  protected sectionTotal(sectionId: string): number { return this.tagsInSection(sectionId).reduce((sum, tag) => sum + this.yearTotal(tag.id), 0); }
  protected monthTotal(kind: 'income' | 'expense', month: number): number { return this.yearTransactions().filter((transaction) => transaction.bookingDate.startsWith(`${this.year()}-${String(month + 1).padStart(2, '0')}`) && (kind === 'income' ? transaction.amountEur > 0 : transaction.amountEur < 0)).reduce((sum, transaction) => sum + transaction.amountEur, 0); }
  protected monthBalance(month: number): number { return this.monthTotal('income', month) + this.monthTotal('expense', month); }
  protected cellTotal(tagId: string, month: number): number { return this.yearTransactions().filter((transaction) => transaction.tagId === tagId && transaction.bookingDate.startsWith(`${this.year()}-${String(month + 1).padStart(2, '0')}`)).reduce((sum, transaction) => sum + transaction.amountEur, 0); }
  protected yearTotal(tagId: string): number { return this.yearTransactions().filter((transaction) => transaction.tagId === tagId).reduce((sum, transaction) => sum + transaction.amountEur, 0); }
  protected childTags(parentId: string): Tag[] { return this.tags().filter((tag) => tag.parentTagId === parentId && !this.isExcluded(tag.id)); }
  protected sectionTags(section: TagSection): Tag[] { return this.tagsInSection(section.id).filter((tag) => !tag.parentTagId && !this.isExcluded(tag.id)); }
  protected tagShare(tagId: string): number { const total = this.tags().filter((tag) => !tag.parentTagId && !this.isExcluded(tag.id)).reduce((sum, tag) => sum + Math.abs(this.yearTotal(tag.id)), 0); return total ? Math.abs(this.yearTotal(tagId)) / total * 100 : 0; }
  protected pieGradient(): string { let cursor = 0; const colors = ['#f20d5d', '#112d4b', '#4f87b9', '#f5a623', '#16845a', '#8c5bb3']; const stops = this.analysisTags().map((tag, index) => { const start = cursor; cursor += this.tagShare(tag.id); return `${colors[index % colors.length]} ${start}% ${cursor}%`; }); return stops.length ? `conic-gradient(${stops.join(', ')})` : '#e4e8ed'; }
  protected chartWidth(tagId: string): number { return Math.min(100, Math.abs(this.yearTotal(tagId)) / Math.max(1, Math.abs(this.totalExpenses())) * 100); }
  protected isExcluded(tagId: string): boolean { return this.excludedTagIds().includes(tagId); }
  protected toggleAnalysisTag(tagId: string): void { this.excludedTagIds.update((ids) => ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId]); this.cashflowChartReady = false; }

  ngAfterViewChecked(): void {
    if (this.homeTab() === 'analysis' && this.cashflowChartElement && (!this.cashflowChartReady || this.cashflowChartHost !== this.cashflowChartElement.nativeElement)) {
      this.renderCashflowChart();
    }
  }

  protected async saveTransaction(): Promise<void> {
    if (!this.merchant.trim() || !this.amount || !this.accountId) return;
    const rate = this.currencies.find((entry) => entry.code === this.currency)?.rate ?? 1;
    await this.repository.saveTransaction({ context: this.context(), bookingDate: this.bookingDate || `${this.year()}-${String(this.month() + 1).padStart(2, '0')}-01`, merchant: this.merchant.trim(), amount: this.amount, currency: this.currency, exchangeRateToEur: rate, amountEur: this.amount * rate, accountId: this.accountId, tagId: this.tagId || undefined, note: this.note.trim() || undefined, location: this.location.trim() || undefined, manuallyTagged: Boolean(this.tagId), tripId: this.context() === 'travel' ? this.selectedTripId() : undefined });
    this.merchant = ''; this.amount = null; this.bookingDate = ''; this.note = ''; this.location = ''; this.tagId = ''; this.currency = 'EUR';
    await this.loadTransactions();
  }

  protected async updateTransaction(transaction: Transaction): Promise<void> { transaction.amountEur = transaction.amount * transaction.exchangeRateToEur; await this.repository.saveTransaction(transaction); await this.loadTransactions(); }
  protected async updateTagTerms(tag: Tag, terms: string): Promise<void> { tag.autoTagTerms = terms.split(',').map((term) => term.trim()).filter((term) => Boolean(term)); await this.updateTag(tag); }
  protected async addTag(): Promise<void> { if (!this.newTagName.trim()) return; await this.repository.saveTag({ id: crypto.randomUUID(), name: this.newTagName.trim(), sectionId: this.newTagSectionId || undefined, parentTagId: this.newTagParentId || undefined, autoTagTerms: this.newTagTerms.split(',').map((term) => term.trim()).filter(Boolean) }); this.newTagName = ''; this.newTagTerms = ''; this.newTagParentId = ''; await this.loadData(); }
  protected async updateTag(tag: Tag): Promise<void> { await this.repository.saveTag(tag); await this.loadData(); }
  protected async deleteTag(id: string): Promise<void> { await this.repository.deleteTag(id); await this.loadData(); }
  protected async addSection(): Promise<void> { if (!this.newSectionName.trim()) return; await this.repository.saveSection({ id: crypto.randomUUID(), name: this.newSectionName.trim(), kind: this.newSectionKind }); this.newSectionName = ''; await this.loadData(); }
  protected async runAutoTagging(): Promise<void> { await this.repository.applyAutoTags(); await this.loadTransactions(); }
  protected async addAccount(): Promise<void> { if (!this.newAccountName.trim()) return; await this.repository.saveAccount({ id: crypto.randomUUID(), name: this.newAccountName.trim(), listed: true }); this.newAccountName = ''; await this.loadData(); }
  protected async updateAccount(account: Account): Promise<void> { await this.repository.saveAccount(account); await this.loadData(); }
  protected async importTradeRepublic(): Promise<void> {
    const rows = this.parseTradeRepublicCsv(this.tradeRepublicCsv);
    if (!rows.length) { this.importStatus = 'Keine gültigen Buchungen gefunden.'; return; }
    let account = this.accounts().find((entry) => entry.name.toLowerCase() === 'trade republic');
    if (!account) { account = { id: crypto.randomUUID(), name: 'Trade Republic', listed: true }; await this.repository.saveAccount(account); await this.loadData(); }
    const existing = new Set((await this.repository.listTransactions('home')).map((transaction) => transaction.id));
    let imported = 0;
    for (const row of rows) {
      const id = this.tradeRepublicId(row);
      if (existing.has(id)) continue;
      const amount = row.value;
      await this.repository.saveTransaction({ id, context: 'home', bookingDate: row.date, merchant: row.note || row.type, amount, currency: 'EUR', exchangeRateToEur: 1, amountEur: amount, accountId: account.id, manuallyTagged: false, note: `Trade Republic · ${row.type}` });
      imported++;
    }
    this.importStatus = `${imported} Buchungen importiert${imported < rows.length ? `, ${rows.length - imported} bereits vorhanden` : ''}.`;
    await this.loadTransactions();
  }
  protected tradeRepublicPreview(): TradeRepublicRow[] { return this.parseTradeRepublicCsv(this.tradeRepublicCsv).slice(0, 8); }
  protected async addTrip(): Promise<void> { if (!this.newTripName.trim() || !this.newTripBudget) return; const id = crypto.randomUUID(); await this.repository.saveTrip({ id, name: this.newTripName.trim(), startDate: `${this.year()}-01-01`, endDate: `${this.year()}-12-31`, budget: this.newTripBudget }); this.newTripName = ''; this.newTripBudget = null; this.selectedTripId.set(id); await this.loadData(); await this.loadTransactions(); }
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
    const links: { source: string; target: string; value: number }[] = [];
    const addNode = (name: string): void => { if (!nodes.some((node) => node.name === name)) nodes.push({ name }); };
    const budgetNode = 'Gesamtbudget';
    addNode(budgetNode);
    for (const section of this.sections()) {
      const sectionValue = Math.abs(this.sectionTotal(section.id));
      if (!sectionValue) continue;
      const sectionNode = `${section.kind === 'income' ? 'Einnahmen' : 'Ausgaben'} · ${section.name}`;
      addNode(sectionNode);
      if (section.kind === 'income') links.push({ source: sectionNode, target: budgetNode, value: sectionValue });
      else links.push({ source: budgetNode, target: sectionNode, value: sectionValue });
      for (const tag of this.sectionTags(section)) {
        const tagValue = Math.abs(this.yearTotal(tag.id));
        if (!tagValue) continue;
        const tagNode = `${sectionNode} / ${tag.name}`;
        addNode(tagNode);
        if (section.kind === 'income') links.push({ source: tagNode, target: sectionNode, value: tagValue });
        else links.push({ source: sectionNode, target: tagNode, value: tagValue });
        for (const child of this.childTags(tag.id)) {
          const childValue = Math.abs(this.yearTotal(child.id));
          if (!childValue) continue;
          const childNode = `${tagNode} / ${child.name}`;
          addNode(childNode);
          if (section.kind === 'income') links.push({ source: childNode, target: tagNode, value: childValue });
          else links.push({ source: tagNode, target: childNode, value: childValue });
        }
      }
    }
    this.cashflowChart.setOption({ animationDuration: 700, tooltip: { trigger: 'item', formatter: '{b}: {c} EUR' }, series: [{ type: 'sankey', left: 8, right: 8, top: 12, bottom: 12, nodeAlign: 'justify', nodeGap: 18, draggable: true, emphasis: { focus: 'adjacency' }, data: nodes, links, label: { color: '#112d4b', fontSize: 11 }, lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.42 }, itemStyle: { borderColor: '#fff', borderWidth: 1 } }] });
    this.cashflowChartReady = true;
  }

  private async initialize(): Promise<void> { await this.repository.seed(); await this.loadData(); this.accountId = this.accounts()[0]?.id ?? ''; this.selectedTripId.set(this.trips()[0]?.id); await this.loadTransactions(); }
  private async loadData(): Promise<void> { const [accounts, tags, sections, trips] = await Promise.all([this.repository.listAccounts(), this.repository.listTags(), this.repository.listSections(), this.repository.listTrips()]); this.accounts.set(accounts); this.tags.set(tags); this.sections.set(sections); this.trips.set(trips); }
  private async loadTransactions(): Promise<void> { this.transactions.set(await this.repository.listTransactions(this.context())); }
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
      return { date: (columns[0] ?? '').slice(0, 10), type, value: signedValue, note: columns[3] ?? '' };
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
  private tradeRepublicId(row: TradeRepublicRow): string { let hash = 2166136261; for (const character of `${row.date}|${row.type}|${row.value}|${row.note}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619); return `tr-import-${(hash >>> 0).toString(16)}`; }
}