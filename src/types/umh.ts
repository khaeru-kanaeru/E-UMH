export type NavTab = 'home' | 'database' | 'std_params' | 'lists' | 'recycle_bin';

export type AllowanceMode = 'none' | 'by_process' | 'by_final';

export type ProcessId = number;

export type ResultVariant = 'reg' | 'smv';

export type UiLang = 'id' | 'en' | 'jp';

export interface AssyParams {
  assyNo: string;
  customer: string;
  yearQty?: number;
  lot?: number;
  masterCct: number;
  pfdAllowancePct: number;
  allowanceMode: AllowanceMode;
  difficultyRating?: number;
  _recycleBinMeta?: {
    binId: string;
    deletedAt: string;
  };
}

export interface AssemblyComponents {
  markerQty: number; // nm
  spotTapeQty: number; // ns
  namePlateQty: number; // nn
  clipQty: number; // nx
  clampQty: number; // ny
}

export interface PartListItem {
  customer: string;
  assyNo: string;
  partNumber: string;
  partName: string;
  qty: number;
  unit?: string;
  routingId: number;
  desc: string;
}

export interface MarkerListItem {
  no?: string;
  assyNo?: string;
  partNo: string;
  partName: string;
  qty: number;
  unit?: string;
  proses?: string;
  supply?: string;
}

export interface PpcsWireItem {
  assyNo: string;
  cctNo: string;
  kind: string;
  sizeRaw: string;
  colour: string;
  isShield: boolean;
  cl: number;
  from: string;
  to: string;
  jointNo: string;
  twist: string;
  tubeR: string;
  tubeF: string;
  hd: string;
  sd: string;
  termR: string;
  markerR: string;
  dcR: string;
  accR1: string;
  accR2: string;
  termF: string;
  markerF: string;
  accF1: string;
  accF2: string;
  dcF: string;
  rAf: boolean;
  fAf: boolean;
  rAc: boolean;
  fAc: boolean;
  af: string;
  ag: string;
}

export interface AssemblyCotItem {
  type: 'C' | 'T' | 'B';
  tl: number;
  assyNo?: string;
  partName?: string;
  tubeNo?: string;
  tubeName?: string;
  diaCode?: string;
  qty?: number;
  unit?: string;
  proses?: string;
  supply?: string;
}

export type TerminalRatios = Record<string, number>;

export interface AutoCutItem {
  id: string;
  customer: string;
  terminal: string;
  process: string;
}

export interface FeederItem {
  id: string;
  seal: string;
  process: string;
}

export interface StdParamItem {
  id: string;
  sheet: string;
  stage: string;
  name: string;
  basis: string;
  val: number;
}

export interface Matrix2D {
  id: 'acMatrix' | 'saMatrix' | 'mcMatrix' | 'cotMatrix' | 'settingWireMatrix' | 'difficultyMatrix';
  title: string;
  rowLabel: string;
  colLabel: string;
  rowBrackets: { label: string; min: number }[];
  colBrackets: string[];
  values: number[][];
}

export interface ProcessLogicDisc {
  format: 'UMH_PROCESS_DISC_V1';
  processId: ProcessId;
  processName: string;
  jpName: string;
  weight: number;
  version: string;
  description: string;
  isEmptyTemplate?: boolean;
  isCustomProcess?: boolean;
  code: string;
  updatedAt: string;
}

export interface DiscSubStepOutput {
  stage: string;
  name: string;
  basis: string;
  qty: number;
  rate: number;
  baseSec: number;
}

export interface DiscValidationCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface DiscValidationResult {
  valid: boolean;
  checks: DiscValidationCheck[];
  normalizedDisc?: ProcessLogicDisc;
  dryRunSample?: {
    baseSec: number;
    summaryNote: string;
    subSteps: DiscSubStepOutput[];
    deltaVsCurrentSec: number | null;
  };
}

export interface StdDatabase {
  params: StdParamItem[];
  acMatrix: number[][];
  saMatrix: number[][];
  mcMatrix: number[][];
  cotMatrix: number[][];
  settingWireMatrix: number[][];
  difficultyMatrix: number[][];
  processDiscs?: ProcessLogicDisc[];
}

export interface SubStepResult {
  id: string;
  stage: string;
  name: string;
  basis: string;
  qty: number;
  rate: number;
  baseSec: number;
  allowByProcessSec: number;
  allowByFinalSec: number;
}

export interface ProcessResult {
  processId: ProcessId;
  processName: string;
  jpName: string;
  weight: number;
  active: boolean;
  summaryNote: string;
  baseSec: number;
  allowByProcessSec: number;
  allowByFinalSec: number;
  subSteps: SubStepResult[];
}

export interface LotMetrics {
  monthlyQty: number;
  dailyQty: number;
  rawLot: number;
  effectiveLot: number;
  isAutoCutActive: boolean;
}

export interface CalculationVariant {
  totalBaseSec: number;
  totalAllowByProcessSec: number;
  totalAllowByFinalSec: number;
  processes: ProcessResult[];
  twistBundlesCount: number;
}

export interface CalculationResult {
  lotMetrics: LotMetrics;
  totalBaseSec: number;
  totalAllowByProcessSec: number;
  totalAllowByFinalSec: number;
  processes: ProcessResult[];
  twistBundlesCount: number;
  autoCutCandidateTerminals: { partNo: string; count: number }[];
  difficultyRating?: number;
  difficultyPct?: number;
  smv?: CalculationVariant;
}

export interface AssyInputPayload {
  id: string;
  createdAt: string;
  updatedAt: string;
  params: AssyParams;
  assemblyComponents: AssemblyComponents;
  partList: PartListItem[];
  ppcsList: PpcsWireItem[];
  assemblyCotList: AssemblyCotItem[];
  terminalRatios: TerminalRatios;
}

export interface AssyRecord extends AssyInputPayload {
  calculation: CalculationResult;
}

export interface SubStepDiff {
  key: string;
  stage: string;
  name: string;
  basis: string;
  beforeBaseSec: number;
  afterBaseSec: number;
  deltaBaseSec: number;
  beforeAllowSec: number;
  afterAllowSec: number;
  deltaAllowSec: number;
}

export interface ProcessDiff {
  processId: ProcessId;
  processName: string;
  jpName: string;
  beforeBaseSec: number;
  afterBaseSec: number;
  deltaBaseSec: number;
  beforeAllowSec: number;
  afterAllowSec: number;
  deltaAllowSec: number;
  subStepDiffs: SubStepDiff[];
}

export interface AssyRefreshDiff {
  assyId: string;
  assyNo: string;
  customer: string;
  allowanceMode: AllowanceMode;
  beforeBaseSec: number;
  afterBaseSec: number;
  deltaBaseSec: number;
  beforeAllowSec: number;
  afterAllowSec: number;
  deltaAllowSec: number;
  processDiffs: ProcessDiff[];
}

export interface RefreshHistoryEntry {
  id: string;
  refreshedAt: string;
  responsibleName: string;
  totalSelectedCount: number;
  affectedAssyCount: number;
  unaffectedAssyCount: number;
  affectedDiffs: AssyRefreshDiff[];
}

export type RecycleBinItemType =
  | 'assy_record'
  | 'refresh_history'
  | 'auto_cut_item'
  | 'feeder_item'
  | 'process_disc';

export type RecycleBinOriginalCollection =
  | 'assyRecords'
  | 'refreshHistory'
  | 'masterConfigs';

export interface RecycleBinItem {
  id: string;
  itemType: RecycleBinItemType;
  originalCollection: RecycleBinOriginalCollection;
  originalId: string;
  title: string;
  subtitle: string;
  deletedAt: string;
  payload: Record<string, unknown>;
}

export type MasterChangeCategory = 'std_params' | 'std_matrices' | 'auto_cut' | 'feeder';

export type MasterChangeSource = 'manual_edit' | 'excel_upload' | 'reset_default';

export type MasterChangeAction = 'added' | 'modified' | 'removed';

export interface MasterChangeDiffItem {
  key: string;
  group: string;
  label: string;
  subLabel?: string;
  action: MasterChangeAction;
  beforeValue: string;
  afterValue: string;
  deltaNumeric?: number | null;
}

export interface MasterChangeHistoryEntry {
  id: string;
  changedAt: string;
  responsibleName: string;
  category: MasterChangeCategory;
  source: MasterChangeSource;
  sourceFileName?: string;
  note?: string;
  totalItemsCount: number;
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
  changes: MasterChangeDiffItem[];
}

