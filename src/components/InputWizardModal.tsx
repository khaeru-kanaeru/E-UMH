import { useEffect, useMemo, useRef, useState } from 'react';
import { useEnterKeyNavigation } from '../hooks/useEnterKeyNavigation';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  Loader2,
  Sliders,
  UploadCloud,
  Wrench,
  X,
} from 'lucide-react';
import { calculateCotTapingV2Summary } from '../data/cotMasterV2';
import {
  DEFAULT_LOT_SIZE,
  extractAutoCutCandidateTerminals,
  parseWireSize,
} from '../engine/umhCalculator';
import { DuplicateAssyMatch } from '../services/firestoreService';
import {
  AllowanceMode,
  AssemblyComponents,
  AssemblyCotItem,
  AssyInputPayload,
  AssyParams,
  AutoCutItem,
  FeederItem,
  MarkerListItem,
  PartListItem,
  PpcsWireItem,
  TerminalRatios,
} from '../types/umh';
import {
  DetectedTemplateFormat,
  downloadUmhTemplateCsv,
  downloadUmhTemplateXlsx,
  parseDrawingFromGrid,
  parseMarkerListFromGrid,
  parseMasterWorkbook,
  parsePartListFromGrid,
  parsePartMasterFromGrid,
  parsePpcsFromGrid,
  parseSingleSheetGrid,
} from '../utils/excelParser';
import {
  SPOT_TAPE_LENGTH_M,
  calculateSpotTapeFromPartList,
  evaluateSpotTapePartItem,
} from '../utils/spotTapeCalculator';

interface TemplateImportReport {
  fileName: string;
  detectedFormat: DetectedTemplateFormat;
  plSheetName?: string;
  ppcsSheetName?: string;
  cotSheetName?: string;
  markerSheetName?: string;
  ignoredSheets?: string[];
  extractedAssyNo: string;
  extractedCustomer: string;
  extractedCct: number;
  plCount: number;
  housingConnTypes: number;
  housingConnQty: number;
  acTermCount: number;
  afSealCount: number;
  jointQty: number;
  asmDetected: string[];
}

interface InputWizardModalProps {
  initialPayload?: AssyInputPayload | null;
  autoCutList: AutoCutItem[];
  feederList: FeederItem[];
  cotMatrix?: number[][];
  onCheckDuplicateAssy?: (assyNo: string, excludeId?: string) => Promise<DuplicateAssyMatch | null>;
  onClose: () => void;
  onSaveAndCalculate: (payload: AssyInputPayload) => void;
}

export function InputWizardModal({
  initialPayload,
  autoCutList,
  feederList,
  cotMatrix,
  onCheckDuplicateAssy,
  onClose,
  onSaveAndCalculate,
}: InputWizardModalProps) {
  const [assyNo, setAssyNo] = useState<string>(initialPayload?.params.assyNo ?? '');
  const [customer, setCustomer] = useState<string>(initialPayload?.params.customer ?? '');
  const [masterCctStr, setMasterCctStr] = useState<string>(
    initialPayload && initialPayload.params.masterCct > 0
      ? String(initialPayload.params.masterCct)
      : ''
  );
  const [lotStr, setLotStr] = useState<string>(
    initialPayload?.params.lot && initialPayload.params.lot > 0
      ? String(initialPayload.params.lot)
      : String(DEFAULT_LOT_SIZE)
  );

  // Preserve existing allowance/difficulty when editing; new Assy always starts at 0 / 'none'
  // and is configured after calculation in the Preview modal.
  const preservedAllowanceMode: AllowanceMode = initialPayload?.params.allowanceMode ?? 'none';
  const preservedPfdAllowancePct: number =
    preservedAllowanceMode === 'none' ? 0 : Math.max(0, initialPayload?.params.pfdAllowancePct ?? 0);
  const preservedDifficultyRating: number =
    typeof initialPayload?.params.difficultyRating === 'number' &&
    Number.isFinite(initialPayload.params.difficultyRating)
      ? Math.max(0, Math.min(5, Math.round(initialPayload.params.difficultyRating * 2) / 2))
      : 0;

  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationField, setValidationField] = useState<'masterCct' | 'lot' | null>(null);

  const [duplicateMatch, setDuplicateMatch] = useState<DuplicateAssyMatch | null>(null);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [assemblyComponents, setAssemblyComponents] = useState<AssemblyComponents>(
    initialPayload?.assemblyComponents ?? {
      markerQty: 0,
      spotTapeQty: 0,
      namePlateQty: 0,
      clipQty: 0,
      clampQty: 0,
    }
  );

  const [entryMode, setEntryMode] = useState<'choose' | 'template' | 'manual'>(
    initialPayload ? 'manual' : 'choose'
  );
  const [partList, setPartList] = useState<PartListItem[]>(initialPayload?.partList ?? []);
  const [ppcsList, setPpcsList] = useState<PpcsWireItem[]>(initialPayload?.ppcsList ?? []);
  const [assemblyCotList, setAssemblyCotList] = useState<AssemblyCotItem[]>(
    initialPayload?.assemblyCotList ?? []
  );
  const [markerList, setMarkerList] = useState<MarkerListItem[]>([]);
  const [terminalRatios, setTerminalRatios] = useState<TerminalRatios>(
    initialPayload?.terminalRatios ?? {}
  );

  const [applyAllRatio, setApplyAllRatio] = useState<number>(100);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [templateImportReport, setTemplateImportReport] = useState<TemplateImportReport | null>(
    null
  );
  const [isParsingTemplate, setIsParsingTemplate] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<
    'partlist' | 'ppcs' | 'assembly' | 'marker' | null
  >(null);

  const formContainerRef = useRef<HTMLDivElement>(null);
  const assyNoInputRef = useRef<HTMLInputElement>(null);
  const cctInputRef = useRef<HTMLInputElement>(null);
  const lotInputRef = useRef<HTMLInputElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  const masterInputRef = useRef<HTMLInputElement>(null);
  const partListInputRef = useRef<HTMLInputElement>(null);
  const ppcsInputRef = useRef<HTMLInputElement>(null);
  const cotInputRef = useRef<HTMLInputElement>(null);
  const markerInputRef = useRef<HTMLInputElement>(null);

  const parsedMasterCct = masterCctStr.trim() === '' ? 0 : Math.max(0, Number(masterCctStr) || 0);
  const parsedLot = lotStr.trim() === '' ? 0 : Math.max(0, Number(lotStr) || 0);

  // Track unsaved edits for cancel confirmation on X / Batal
  const isDirty = useMemo(() => {
    const initAssy = initialPayload?.params.assyNo ?? '';
    const initCust = initialPayload?.params.customer ?? '';
    const initCct =
      initialPayload && initialPayload.params.masterCct > 0
        ? String(initialPayload.params.masterCct)
        : '';
    const initLot =
      initialPayload?.params.lot && initialPayload.params.lot > 0
        ? String(initialPayload.params.lot)
        : String(DEFAULT_LOT_SIZE);
    const initAsm = initialPayload?.assemblyComponents ?? {
      markerQty: 0,
      spotTapeQty: 0,
      namePlateQty: 0,
      clipQty: 0,
      clampQty: 0,
    };

    return (
      assyNo !== initAssy ||
      customer !== initCust ||
      masterCctStr !== initCct ||
      lotStr !== initLot ||
      partList.length !== (initialPayload?.partList.length ?? 0) ||
      ppcsList.length !== (initialPayload?.ppcsList.length ?? 0) ||
      assemblyCotList.length !== (initialPayload?.assemblyCotList.length ?? 0) ||
      assemblyComponents.markerQty !== initAsm.markerQty ||
      assemblyComponents.spotTapeQty !== initAsm.spotTapeQty ||
      assemblyComponents.namePlateQty !== initAsm.namePlateQty ||
      assemblyComponents.clipQty !== initAsm.clipQty ||
      assemblyComponents.clampQty !== initAsm.clampQty
    );
  }, [
    initialPayload,
    assyNo,
    customer,
    masterCctStr,
    lotStr,
    partList.length,
    ppcsList.length,
    assemblyCotList.length,
    assemblyComponents,
  ]);

  const handleRequestClose = () => {
    if (isDirty) {
      setShowCancelConfirm(true);
    } else {
      onClose();
    }
  };

  // Debounced duplicate Assy Number detection across shared database
  useEffect(() => {
    if (!onCheckDuplicateAssy) return;
    const trimmed = assyNo.trim();
    if (trimmed.length < 2) {
      setDuplicateMatch(null);
      setIsCheckingDuplicate(false);
      return;
    }

    let cancelled = false;
    setIsCheckingDuplicate(true);
    const timer = setTimeout(() => {
      void onCheckDuplicateAssy(trimmed, initialPayload?.id)
        .then((match) => {
          if (!cancelled) {
            setDuplicateMatch(match);
            setIsCheckingDuplicate(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setDuplicateMatch(null);
            setIsCheckingDuplicate(false);
          }
        });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [assyNo, initialPayload?.id, onCheckDuplicateAssy]);

  // Ref-backed Enter key navigation: cycles through visible inputs & visually manages focus
  const { activeFieldIndex, totalFields, focusField } = useEnterKeyNavigation(formContainerRef, {
    submitRef: submitButtonRef,
    disabled: Boolean(previewTarget) || showCancelConfirm || entryMode === 'choose',
  });

  // Auto-focus appropriate input field when entering template or manual workspace
  useEffect(() => {
    if (entryMode === 'choose') return;
    requestAnimationFrame(() => {
      focusField(assyNoInputRef.current);
    });
  }, [entryMode, focusField]);

  const clearValidation = () => {
    if (validationError) setValidationError(null);
    if (validationField) setValidationField(null);
  };

  const candidateTerminals = useMemo(
    () => extractAutoCutCandidateTerminals(ppcsList),
    [ppcsList]
  );

  const plSummary = useMemo(() => {
    const uniqAc = new Set(
      partList
        .filter((r) => r.desc === 'auto cut' || r.desc.includes('auto cut'))
        .map((r) => r.partNumber.toUpperCase())
    ).size;
    const uniqAf = new Set(
      partList.filter((r) => r.desc === 'auto feeder').map((r) => r.partNumber.toUpperCase())
    ).size;
    const jointCodes = new Set([
      '553800', '565200', 'B-1.25', 'B-2', 'B-5.5', 'B-8', 'B-14', 'B-22', 'B-38', 'B-60',
      'P-1.25', 'P-2', 'P-5.5', 'P-8', 'P-14', 'P-22', 'P-38', 'P-60',
    ]);
    const jSum = partList
      .filter((r) => jointCodes.has(r.partNumber.toUpperCase()))
      .reduce((a, b) => a + b.qty, 0);
    const housingConns = partList.filter(
      (r) => r.routingId === 20 && r.partName.toLowerCase() === 'connector'
    );
    const housingConnTypes = housingConns.length;
    const housingConnQty = housingConns.reduce((a, b) => a + b.qty, 0);
    return { rows: partList.length, uniqAc, uniqAf, jSum, housingConnTypes, housingConnQty };
  }, [partList]);

  const ppcsSummary = useMemo(() => {
    const ac = ppcsList.filter(
      (r) => (r.rAc || r.fAc) && parseWireSize(r.sizeRaw) < 3
    ).length;
    const tw = ppcsList.filter((r) => r.twist !== '').length;
    const sh = ppcsList.filter(
      (r) => r.colour.length >= 2 && r.colour[1].toUpperCase() === 'C'
    ).length;
    return { total: ppcsList.length, ac, tw, sh };
  }, [ppcsList]);

  const cotV2Summary = useMemo(
    () => calculateCotTapingV2Summary(assemblyCotList, partList, cotMatrix),
    [assemblyCotList, partList, cotMatrix]
  );

  const cotSummary = useMemo(() => {
    const totalTl = assemblyCotList.reduce(
      (a, b) => a + b.tl * (b.qty && b.qty > 0 ? b.qty : 1),
      0
    );
    const bareTl = assemblyCotList
      .filter((r) => r.type === 'B')
      .reduce((a, b) => a + b.tl * (b.qty && b.qty > 0 ? b.qty : 1), 0);
    const cCount = assemblyCotList.filter((r) => r.type === 'C').length;
    return {
      count: assemblyCotList.length,
      cCount,
      tapingTl: totalTl - bareTl,
      v2: cotV2Summary,
    };
  }, [assemblyCotList, cotV2Summary]);

  const spotTapeSummary = useMemo(
    () => calculateSpotTapeFromPartList(partList),
    [partList]
  );

  const markerPreviewItems = useMemo(() => {
    if (markerList.length > 0) {
      return {
        source: 'sheet' as const,
        items: markerList,
        totalQty: markerList.reduce((acc, item) => acc + item.qty, 0),
      };
    }
    const derived: MarkerListItem[] = partList
      .filter(
        (r) =>
          r.partName.toLowerCase().includes('marker') ||
          r.partNumber.toLowerCase().includes('marker')
      )
      .map((r, idx) => ({
        no: String(idx + 1),
        assyNo: r.assyNo,
        partNo: r.partNumber,
        partName: r.partName,
        qty: r.qty,
        unit: r.unit || 'Pcs',
      }));
    return {
      source: 'partlist' as const,
      items: derived,
      totalQty: derived.reduce((acc, item) => acc + item.qty, 0),
    };
  }, [markerList, partList]);

  const deriveAsmComponentsFromPl = (
    parsedPl: PartListItem[],
    baseAsm: AssemblyComponents,
    options?: { preserveMarkerIfSet?: boolean; preserveSpotIfZero?: boolean }
  ): AssemblyComponents => {
    if (parsedPl.length === 0) return baseAsm;
    const plMarkerQty = parsedPl
      .filter(
        (r) =>
          r.partName.toLowerCase().includes('marker') ||
          r.partNumber.toLowerCase().includes('marker')
      )
      .reduce((a, b) => a + b.qty, 0);
    const plSpot = calculateSpotTapeFromPartList(parsedPl).spotCount;
    return {
      ...baseAsm,
      markerQty:
        options?.preserveMarkerIfSet && baseAsm.markerQty > 0
          ? baseAsm.markerQty
          : plMarkerQty,
      spotTapeQty:
        plSpot > 0
          ? plSpot
          : options?.preserveSpotIfZero
          ? baseAsm.spotTapeQty
          : 0,
      namePlateQty: parsedPl
        .filter(
          (r) =>
            r.partName.toLowerCase().includes('name plate') ||
            r.partName.toLowerCase().includes('nameplate')
        )
        .reduce((a, b) => a + b.qty, 0),
      clipQty: parsedPl
        .filter((r) => r.partName.toLowerCase().includes('clip'))
        .reduce((a, b) => a + b.qty, 0),
      clampQty: parsedPl
        .filter((r) => r.partName.toLowerCase().includes('clamp'))
        .reduce((a, b) => a + b.qty, 0),
    };
  };

  const applyPartListSideEffects = (
    parsedPl: PartListItem[],
    autoPopulateAsm: boolean
  ) => {
    if (parsedPl.length > 0) {
      setAssyNo((prev) => prev || parsedPl[0].assyNo);
      setCustomer((prev) => prev || parsedPl[0].customer);
    }
    if (autoPopulateAsm && parsedPl.length > 0) {
      setAssemblyComponents((prev) => deriveAsmComponentsFromPl(parsedPl, prev));
    }
  };

  const handleTemplateUpload = async (file: File) => {
    setIsParsingTemplate(true);
    setTemplateImportReport(null);
    clearValidation();
    setStatusMessage(`Memproses template "${file.name}"...`);
    try {
      const parsed = await parseMasterWorkbook(file, autoCutList, feederList);

      const nextPl = parsed.partList ?? partList;
      const nextPpcs = parsed.ppcsList ?? ppcsList;
      const nextCot = parsed.assemblyCotList ?? assemblyCotList;

      const nextAssyNo =
        parsed.params?.assyNo ||
        assyNo ||
        nextPl[0]?.assyNo ||
        nextPpcs[0]?.assyNo ||
        '';
      const nextCustomer =
        parsed.params?.customer || customer || nextPl[0]?.customer || '';
      const nextMasterCct =
        parsed.params?.masterCct && parsed.params.masterCct > 0
          ? parsed.params.masterCct
          : parsedMasterCct;
      const nextLot =
        parsed.params?.lot && parsed.params.lot > 0
          ? parsed.params.lot
          : parsedLot > 0
          ? parsedLot
          : DEFAULT_LOT_SIZE;

      const hasMarkerFromSheet = Boolean(
        parsed.assemblyComponents?.markerQty && parsed.assemblyComponents.markerQty > 0
      );
      const hasSpotFromTemplate = Boolean(
        parsed.assemblyComponents?.spotTapeQty && parsed.assemblyComponents.spotTapeQty > 0
      );
      let nextAsm: AssemblyComponents = {
        ...assemblyComponents,
        ...(parsed.assemblyComponents ?? {}),
      };
      if (parsed.partList && parsed.partList.length > 0) {
        nextAsm = deriveAsmComponentsFromPl(parsed.partList, nextAsm, {
          preserveMarkerIfSet: hasMarkerFromSheet,
          preserveSpotIfZero: hasSpotFromTemplate,
        });
      }

      const nextRatios: TerminalRatios = {
        ...terminalRatios,
        ...(parsed.terminalRatios ?? {}),
      };
      const parsedCandidates = extractAutoCutCandidateTerminals(nextPpcs);
      for (const item of parsedCandidates) {
        if (nextRatios[item.partNo] === undefined) nextRatios[item.partNo] = 100;
      }

      setAssyNo(nextAssyNo);
      setCustomer(nextCustomer);
      if (nextMasterCct > 0) setMasterCctStr(String(nextMasterCct));
      setLotStr(String(nextLot));

      if (parsed.partList) setPartList(parsed.partList);
      if (parsed.ppcsList) setPpcsList(parsed.ppcsList);
      if (parsed.assemblyCotList) setAssemblyCotList(parsed.assemblyCotList);
      if (parsed.markerList) setMarkerList(parsed.markerList);
      setAssemblyComponents(nextAsm);
      setTerminalRatios(nextRatios);

      // Automatically enter Template workspace when uploaded from the method chooser
      if (entryMode === 'choose') {
        setEntryMode('template');
      }

      const nextParamsExtractedCct = nextMasterCct;

      const jointCodes = new Set([
        '553800', '565200', 'B-1.25', 'B-2', 'B-5.5', 'B-8', 'B-14', 'B-22', 'B-38', 'B-60',
        'P-1.25', 'P-2', 'P-5.5', 'P-8', 'P-14', 'P-22', 'P-38', 'P-60',
      ]);
      const housingConns = nextPl.filter(
        (r) => r.routingId === 20 && r.partName.toLowerCase() === 'connector'
      );
      const acTermCount = new Set(
        nextPl
          .filter((r) => r.desc === 'auto cut' || r.desc.includes('auto cut'))
          .map((r) => r.partNumber.toUpperCase())
      ).size;
      const afSealCount = new Set(
        nextPl.filter((r) => r.desc === 'auto feeder').map((r) => r.partNumber.toUpperCase())
      ).size;
      const jointQty = nextPl
        .filter((r) => jointCodes.has(r.partNumber.toUpperCase()))
        .reduce((a, b) => a + b.qty, 0);

      const spotCalc = calculateSpotTapeFromPartList(nextPl);
      const asmDetected: string[] = [];
      if (nextAsm.markerQty > 0) asmDetected.push(`Marker: ${nextAsm.markerQty}`);
      if (nextAsm.spotTapeQty > 0) {
        asmDetected.push(
          spotCalc.totalMeters > 0
            ? `Spot Tape: ${nextAsm.spotTapeQty} (${spotCalc.totalMeters.toFixed(2)}m)`
            : `Spot Tape: ${nextAsm.spotTapeQty}`
        );
      }
      if (nextAsm.namePlateQty > 0) asmDetected.push(`Name Plate: ${nextAsm.namePlateQty}`);
      if (nextAsm.clipQty > 0) asmDetected.push(`Clip: ${nextAsm.clipQty}`);
      if (nextAsm.clampQty > 0) asmDetected.push(`Clamp: ${nextAsm.clampQty}`);

      setTemplateImportReport({
        fileName: file.name,
        detectedFormat: parsed.detectedFormat,
        plSheetName: parsed.plSheetName,
        ppcsSheetName: parsed.ppcsSheetName,
        cotSheetName: parsed.cotSheetName,
        markerSheetName: parsed.markerSheetName,
        ignoredSheets: parsed.ignoredSheets,
        extractedAssyNo: nextAssyNo || '-',
        extractedCustomer: nextCustomer || '-',
        extractedCct: nextParamsExtractedCct,
        plCount: nextPl.length,
        housingConnTypes: housingConns.length,
        housingConnQty: housingConns.reduce((a, b) => a + b.qty, 0),
        acTermCount,
        afSealCount,
        jointQty,
        asmDetected,
      });
      setStatusMessage(
        'Template berhasil dimuat & komponen tervalidasi. Klik "Hitung & Preview Hasil" untuk melihat hasil dan menetapkan Allowance / Tingkat Kesulitan.'
      );
    } catch {
      setStatusMessage(
        'Gagal membaca file template. Pastikan format .xlsx, .xls, atau .csv valid.'
      );
    } finally {
      setIsParsingTemplate(false);
    }
  };

  const handlePartListUpload = async (file: File) => {
    setIsParsingTemplate(true);
    try {
      const grid = await parseSingleSheetGrid(file, 'pl');
      const parsed = parsePartListFromGrid(grid, autoCutList, feederList);
      const masterMeta = parsePartMasterFromGrid(grid).params;
      setPartList(parsed);
      applyPartListSideEffects(parsed, true);

      if (masterMeta) {
        if (masterMeta.assyNo) setAssyNo(masterMeta.assyNo);
        if (masterMeta.customer) setCustomer(masterMeta.customer);
        if (masterMeta.masterCct && masterMeta.masterCct > 0) {
          setMasterCctStr(String(masterMeta.masterCct));
        }
        if (masterMeta.lot && masterMeta.lot > 0) {
          setLotStr(String(masterMeta.lot));
        }
      }

      if (ppcsList.length > 0) {
        const slvSet = new Set(
          parsed
            .filter((x) => x.partName.toLowerCase() === 'sleeve')
            .map((x) => x.partNumber.toLowerCase())
        );
        setPpcsList((prev) =>
          prev.map((r) => ({
            ...r,
            af: slvSet.has(r.accR1.toLowerCase()) ? 'Sleeve' : '',
            ag: slvSet.has(r.accF1.toLowerCase()) ? 'Sleeve' : '',
          }))
        );
      }

      const metaNote =
        masterMeta?.assyNo || masterMeta?.masterCct
          ? ` (Assy: ${masterMeta.assyNo || '-'}, CCT: ${masterMeta.masterCct || '-'})`
          : '';
      setStatusMessage(`PART LIST "${file.name}" dimuat: ${parsed.length} baris${metaNote}.`);
    } catch {
      setStatusMessage('Gagal membaca file PART LIST.');
    } finally {
      setIsParsingTemplate(false);
    }
  };

  const handlePpcsUpload = async (file: File) => {
    setIsParsingTemplate(true);
    try {
      const grid = await parseSingleSheetGrid(file, 'ppcs');
      const fallbackAssy = assyNo || partList[0]?.assyNo || '';
      const parsed = parsePpcsFromGrid(grid, partList, autoCutList, feederList, fallbackAssy);
      setPpcsList(parsed);
      setStatusMessage(`PPCS "${file.name}" dimuat: ${parsed.length} sirkuit.`);
    } catch {
      setStatusMessage('Gagal membaca file PPCS.');
    } finally {
      setIsParsingTemplate(false);
    }
  };

  const handleCotUpload = async (file: File) => {
    setIsParsingTemplate(true);
    try {
      const grid = await parseSingleSheetGrid(file, 'dwg');
      const parsed = parseDrawingFromGrid(grid);
      setAssemblyCotList(parsed);
      setStatusMessage(`Assembly COT "${file.name}" dimuat: ${parsed.length} titik.`);
    } catch {
      setStatusMessage('Gagal membaca file Assembly COT.');
    } finally {
      setIsParsingTemplate(false);
    }
  };

  const handleMarkerUpload = async (file: File) => {
    setIsParsingTemplate(true);
    try {
      const grid = await parseSingleSheetGrid(file, 'marker');
      const parsed = parseMarkerListFromGrid(grid);
      setMarkerList(parsed.items);
      if (parsed.totalQty > 0) {
        setAssemblyComponents((prev) => ({
          ...prev,
          markerQty: parsed.totalQty,
        }));
      }
      setStatusMessage(
        `MARKER LIST "${file.name}" dimuat: ${parsed.items.length} baris (Total Qty: ${parsed.totalQty}).`
      );
    } catch {
      setStatusMessage('Gagal membaca file MARKER LIST.');
    } finally {
      setIsParsingTemplate(false);
    }
  };

  const handleApplyAllRatio = () => {
    const clamped = Math.max(0, Math.min(100, applyAllRatio));
    const next: TerminalRatios = { ...terminalRatios };
    for (const item of candidateTerminals) {
      next[item.partNo] = clamped;
    }
    setTerminalRatios(next);
  };

  const handleSubmit = () => {
    setValidationError(null);
    setValidationField(null);

    if (masterCctStr.trim() === '' || parsedMasterCct <= 0) {
      setValidationError('Jumlah CCT wajib diisi dengan angka lebih dari 0.');
      setValidationField('masterCct');
      focusField(cctInputRef.current);
      return;
    }

    if (lotStr.trim() === '' || parsedLot < 1) {
      setValidationError('Nilai LOT wajib diisi (minimal 1).');
      setValidationField('lot');
      focusField(lotInputRef.current);
      return;
    }

    const cleanAssy = assyNo.trim() || `ASSY-${Date.now()}`;
    const now = new Date().toISOString();
    const finalRatios: TerminalRatios = { ...terminalRatios };
    for (const item of candidateTerminals) {
      if (finalRatios[item.partNo] === undefined) finalRatios[item.partNo] = 100;
    }

    const finalParams: AssyParams = {
      assyNo: cleanAssy,
      customer: customer.trim() || (partList[0]?.customer ?? '-'),
      masterCct: Math.round(parsedMasterCct),
      lot: Math.max(1, Math.round(parsedLot)),
      allowanceMode: preservedAllowanceMode,
      pfdAllowancePct: preservedPfdAllowancePct,
      difficultyRating: preservedDifficultyRating,
    };

    onSaveAndCalculate({
      id: initialPayload?.id ?? `assy_${Date.now()}`,
      createdAt: initialPayload?.createdAt ?? now,
      updatedAt: now,
      createdByUid: initialPayload?.createdByUid,
      createdByName: initialPayload?.createdByName,
      createdByEmail: initialPayload?.createdByEmail,
      updatedByUid: initialPayload?.updatedByUid,
      updatedByName: initialPayload?.updatedByName,
      updatedByEmail: initialPayload?.updatedByEmail,
      params: finalParams,
      assemblyComponents,
      partList,
      ppcsList,
      assemblyCotList,
      terminalRatios: finalRatios,
    });
  };

  const renderParameterInputs = () => (
    <div className="space-y-3.5">
      <div className="space-y-1.5">
        <label className="block space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">Assy Number</span>
            {isCheckingDuplicate && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Cek duplikat...</span>
              </span>
            )}
          </div>
          <input
            ref={assyNoInputRef}
            type="text"
            value={assyNo}
            onChange={(e) => {
              setAssyNo(e.target.value);
              clearValidation();
            }}
            placeholder="Contoh: YA00058702-014"
            className={`w-full px-3 py-2 text-sm font-mono-num bg-slate-50 border rounded-lg focus:bg-white focus:outline-none focus:ring-2 ${
              duplicateMatch
                ? 'border-amber-400 focus:border-amber-500 focus:ring-amber-500/20'
                : 'border-slate-200 focus:border-[#1E3A8A] focus:ring-[#1E3A8A]/20'
            }`}
          />
        </label>

        {duplicateMatch && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-950 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0 leading-relaxed">
              <p className="font-bold text-amber-900">
                Assy Duplikat Terdeteksi ({duplicateMatch.assyNo})
              </p>
              <p className="text-[11px] text-amber-800 mt-0.5">
                Sudah pernah diinput untuk Customer{' '}
                <strong>{duplicateMatch.customer || '-'}</strong>
                {duplicateMatch.createdByName ? (
                  <>
                    {' '}oleh <strong>{duplicateMatch.createdByName}</strong>
                  </>
                ) : null}
                . Periksa kembali nomor Assy atau lanjutkan jika memang membuat entri baru.
              </p>
            </div>
          </div>
        )}
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-semibold text-slate-700">
          Customer (Otomatis dari PART LIST)
        </span>
        <input
          type="text"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          placeholder="Terdeteksi otomatis saat upload PART LIST"
          className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-700">
            Jumlah CCT <span className="text-red-500">*</span>
          </span>
          <input
            ref={cctInputRef}
            type="number"
            min="1"
            required
            aria-required="true"
            value={masterCctStr}
            onChange={(e) => {
              setMasterCctStr(e.target.value);
              clearValidation();
            }}
            className={`w-full px-3 py-2 text-sm font-mono-num bg-slate-50 border rounded-lg focus:bg-white focus:outline-none focus:ring-2 ${
              validationField === 'masterCct'
                ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
                : 'border-slate-200 focus:border-[#1E3A8A] focus:ring-[#1E3A8A]/20'
            }`}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-700">
            LOT <span className="text-[11px] font-normal text-slate-400">(Default 15)</span>
          </span>
          <input
            ref={lotInputRef}
            type="number"
            min="1"
            required
            aria-required="true"
            value={lotStr}
            onChange={(e) => {
              setLotStr(e.target.value);
              clearValidation();
            }}
            className={`w-full px-3 py-2 text-sm font-mono-num bg-slate-50 border rounded-lg focus:bg-white focus:outline-none focus:ring-2 ${
              validationField === 'lot'
                ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
                : 'border-slate-200 focus:border-[#1E3A8A] focus:ring-[#1E3A8A]/20'
            }`}
          />
        </label>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-[11px] text-slate-600 leading-relaxed">
        <strong className="text-slate-800">Penetapan Allowance &amp; Tingkat Kesulitan:</strong>{' '}
        Dilakukan setelah kalkulasi pada tampilan <strong>Preview Hasil</strong> (bersamaan dengan
        tombol Simpan / Konfirmasi Assy).
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-3 sm:p-4">
      <div className="glass-modal w-full max-w-[1360px] max-h-[92vh] rounded-2xl flex flex-col overflow-hidden">
        {/* Persistent Hidden File Inputs (available in all modes) */}
        <input
          ref={masterInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleTemplateUpload(f);
            e.target.value = '';
          }}
          className="hidden"
        />
        <input
          ref={partListInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handlePartListUpload(f);
            e.target.value = '';
          }}
          className="hidden"
        />
        <input
          ref={ppcsInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handlePpcsUpload(f);
            e.target.value = '';
          }}
          className="hidden"
        />
        <input
          ref={cotInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleCotUpload(f);
            e.target.value = '';
          }}
          className="hidden"
        />
        <input
          ref={markerInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleMarkerUpload(f);
            e.target.value = '';
          }}
          className="hidden"
        />

        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4 bg-white">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 truncate">
              {initialPayload
                ? `Edit Konfigurasi · ${initialPayload.params.assyNo}`
                : entryMode === 'choose'
                ? 'Input Data Assy Baru'
                : entryMode === 'template'
                ? 'Input Assy · Metode Template (Utama)'
                : 'Input Assy · Metode Manual (Detail)'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {entryMode === 'choose'
                ? 'Pilih metode input: upload workbook template terformat sebagai jalur utama, atau input manual bertahap.'
                : entryMode === 'template'
                ? 'Upload workbook PART LIST / PL NEW ASSY, PPCS, MARKER LIST, dan COT dengan validasi komponen otomatis.'
                : 'Edit parameter, upload sheet satuan, atur rasio Auto-Cut, dan pratinjau Part List, PPCS, COT, serta Marker.'}
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {entryMode !== 'choose' && (
              <div
                role="tablist"
                aria-label="Metode Input Assy"
                className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={entryMode === 'template'}
                  onClick={() => setEntryMode('template')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    entryMode === 'template'
                      ? 'bg-white text-[#1E3A8A] shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Template (Utama)
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={entryMode === 'manual'}
                  onClick={() => setEntryMode('manual')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    entryMode === 'manual'
                      ? 'bg-white text-[#1E3A8A] shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Manual (Detail)
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleRequestClose}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
              aria-label="Batalkan Input"
              title="Batalkan Operasi"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Compact Template Upload Strip (shown in Template & Manual workspaces) */}
        {entryMode !== 'choose' && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void handleTemplateUpload(f);
            }}
            className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-2.5"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-[#1E3A8A] text-white flex items-center justify-center shrink-0">
                {isParsingTemplate ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="w-4 h-4" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 truncate">
                  {entryMode === 'template'
                    ? 'Workbook Template UMH (.xlsx / .csv) — Jalur Utama'
                    : 'Impor Cepat dari Template UMH (.xlsx / .csv)'}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  Seret file ke sini atau klik Upload — membaca PART LIST / PL NEW ASSY, PPCS, MARKER LIST, &amp; COT (sheet lain diabaikan).
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={downloadUmhTemplateXlsx}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-100 cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 text-[#047857]" />
                <span>Template .xlsx</span>
              </button>
              <button
                type="button"
                onClick={downloadUmhTemplateCsv}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-100 cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 text-[#1E3A8A]" />
                <span>Template .csv</span>
              </button>
              <button
                type="button"
                disabled={isParsingTemplate}
                onClick={() => masterInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#1E3A8A] text-white text-xs font-semibold hover:bg-[#172E6E] disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span>
                  {isParsingTemplate
                    ? 'Memproses...'
                    : templateImportReport
                    ? 'Ganti File Template'
                    : 'Upload Template'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto bg-[#f8fafc]">
          {/* Notices (shared across modes) */}
          {(statusMessage || validationError || templateImportReport) && (
            <div className="px-5 pt-4 space-y-2.5">
              {validationError && (
                <div className="px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-semibold text-red-700 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{validationError}</span>
                  </span>
                  <button
                    type="button"
                    onClick={clearValidation}
                    className="text-red-500 hover:text-red-800 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {statusMessage && (
                <div className="px-3.5 py-2 rounded-lg bg-blue-50 border border-blue-200 text-xs font-medium text-[#1E3A8A] flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    {isParsingTemplate && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
                    <span>{statusMessage}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setStatusMessage(null)}
                    className="text-blue-700 hover:text-blue-900 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {templateImportReport && entryMode !== 'choose' && (
                <div className="rounded-xl border border-emerald-200 bg-white px-4 py-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 text-xs">
                  <div className="flex items-start gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-semibold text-emerald-950 truncate">
                        {templateImportReport.fileName} —{' '}
                        <span className="font-mono-num">
                          Assy {assyNo || templateImportReport.extractedAssyNo} ·{' '}
                          {customer || templateImportReport.extractedCustomer} · CCT {parsedMasterCct || '-'}
                        </span>
                      </p>
                      <p className="text-[11px] text-slate-600 font-mono-num flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                        <span>
                          PL{templateImportReport.plSheetName ? ` (${templateImportReport.plSheetName})` : ''}:{' '}
                          <strong className="text-slate-900">{partList.length} item</strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          PPCS{templateImportReport.ppcsSheetName ? ` (${templateImportReport.ppcsSheetName})` : ''}:{' '}
                          <strong className="text-slate-900">{ppcsList.length} sirkuit</strong>
                          {ppcsList.length > 0 && parsedMasterCct > 0 && ppcsList.length === parsedMasterCct && (
                            <span className="text-emerald-700 font-semibold"> ✓ Cocok CCT</span>
                          )}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          COT{templateImportReport.cotSheetName ? ` (${templateImportReport.cotSheetName})` : ''}:{' '}
                          <strong className="text-slate-900">{assemblyCotList.length} baris</strong>
                          {cotV2Summary.hasCotV2Rows && (
                            <span className="text-emerald-700 font-semibold">
                              {' '}({cotV2Summary.totalSec.toFixed(1)}s / {cotV2Summary.totalBaseUmhHr.toFixed(4)} hr)
                            </span>
                          )}
                        </span>
                        {templateImportReport.markerSheetName && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              Marker ({templateImportReport.markerSheetName}):{' '}
                              <strong className="text-slate-900">{assemblyComponents.markerQty}</strong>
                            </span>
                          </>
                        )}
                        {templateImportReport.asmDetected.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Asm: {templateImportReport.asmDetected.join(', ')}</span>
                          </>
                        )}
                        {templateImportReport.ignoredSheets &&
                          templateImportReport.ignoredSheets.length > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-slate-400">
                                Diabaikan ({templateImportReport.ignoredSheets.length}):{' '}
                                {templateImportReport.ignoredSheets.join(', ')}
                              </span>
                            </>
                          )}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {ppcsList.length === 0 && (
                      <button
                        type="button"
                        onClick={() => ppcsInputRef.current?.click()}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100 text-amber-950 text-[11px] font-semibold hover:bg-amber-200 cursor-pointer whitespace-nowrap"
                      >
                        <AlertCircle className="w-3 h-3 text-amber-700" />
                        <span>Upload PPCS</span>
                      </button>
                    )}
                    {assemblyCotList.length === 0 && (
                      <button
                        type="button"
                        onClick={() => cotInputRef.current?.click()}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100 text-amber-950 text-[11px] font-semibold hover:bg-amber-200 cursor-pointer whitespace-nowrap"
                      >
                        <AlertCircle className="w-3 h-3 text-amber-700" />
                        <span>Upload Assembly COT</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setTemplateImportReport(null)}
                      className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                      aria-label="Tutup Ringkasan Impor"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VIEW 1: Initial Method Selection (Primary = Upload Template, Secondary = Input Manual) */}
          {entryMode === 'choose' ? (
            <div className="p-5 sm:p-6">
              <div className="rounded-xl border border-slate-200 bg-white grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 overflow-hidden">
                {/* PRIMARY METHOD (Default): Upload Formatted Template */}
                <section
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) void handleTemplateUpload(f);
                  }}
                  className="lg:col-span-7 p-6 sm:p-7 flex flex-col justify-between gap-6 bg-white"
                >
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-[#1E3A8A]">
                          Metode Utama · Default
                        </p>
                        <h3 className="text-lg font-bold text-slate-900 mt-1">
                          Upload Template UMH Terformat (.xlsx / .csv)
                        </h3>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                          Upload satu file Excel berformat standar untuk mengekstrak seluruh data Assy, Wire List, Taping COT, Marker, dan estimasi Spot Tape secara otomatis.
                        </p>
                      </div>
                      <div className="w-10 h-10 rounded-xl bg-[#1E3A8A] text-white flex items-center justify-center shrink-0">
                        {isParsingTemplate ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <FileSpreadsheet className="w-5 h-5" />
                        )}
                      </div>
                    </div>

                    {/* Interactive Dropzone */}
                    <div
                      onClick={() => !isParsingTemplate && masterInputRef.current?.click()}
                      className="rounded-xl border-2 border-dashed border-[#1E3A8A]/30 bg-slate-50/80 hover:bg-blue-50/40 hover:border-[#1E3A8A]/60 transition-colors p-6 text-center cursor-pointer"
                    >
                      <UploadCloud className="w-8 h-8 text-[#1E3A8A] mx-auto" />
                      <p className="text-sm font-bold text-slate-900 mt-2.5">
                        {isParsingTemplate
                          ? 'Sedang membaca workbook template...'
                          : 'Seret & lepas file Excel di sini, atau klik untuk memilih file'}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Mendukung sheet <span className="font-mono-num font-semibold text-slate-700">PART LIST</span> /{' '}
                        <span className="font-mono-num font-semibold text-slate-700">PL NEW ASSY</span>,{' '}
                        <span className="font-mono-num font-semibold text-slate-700">PPCS</span>,{' '}
                        <span className="font-mono-num font-semibold text-slate-700">MARKER LIST</span>, dan{' '}
                        <span className="font-mono-num font-semibold text-slate-700">COT</span> (sheet lain otomatis diabaikan).
                      </p>
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          disabled={isParsingTemplate}
                          onClick={(e) => {
                            e.stopPropagation();
                            masterInputRef.current?.click();
                          }}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1E3A8A] text-white text-xs font-semibold hover:bg-[#172E6E] disabled:opacity-50 cursor-pointer"
                        >
                          <UploadCloud className="w-4 h-4" />
                          <span>Upload Template Sekarang</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEntryMode('template');
                          }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-100 cursor-pointer"
                        >
                          <span>Buka Ruang Kerja Template</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Auto-validation highlights */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs text-slate-600">
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-[#047857] shrink-0 mt-0.5" />
                        <span>
                          Metadata <strong className="text-slate-800">ASSY NO, CUSTOMER, QTY CCT</strong> dan tabel Part List / PPCS / COT / Marker diekstrak otomatis.
                        </span>
                      </div>
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-[#047857] shrink-0 mt-0.5" />
                        <span>
                          <strong className="text-slate-800">5 Komponen Assembly tervalidasi otomatis</strong>, termasuk Spot Tape (<span className="font-mono-num">ceil(m Tape non-B ÷ 0.2)</span>).
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Template Download Bar */}
                  <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-slate-500">Belum punya format workbook standar?</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={downloadUmhTemplateXlsx}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5 text-[#047857]" />
                        <span>Unduh Template .xlsx</span>
                      </button>
                      <button
                        type="button"
                        onClick={downloadUmhTemplateCsv}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5 text-[#1E3A8A]" />
                        <span>Template .csv</span>
                      </button>
                    </div>
                  </div>
                </section>

                {/* SECONDARY METHOD: Manual Input */}
                <section className="lg:col-span-5 p-6 sm:p-7 flex flex-col justify-between gap-6 bg-slate-50/70">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          Metode Sekunder · Kontrol Detail
                        </p>
                        <h3 className="text-base font-bold text-slate-900 mt-1">
                          Input Manual &amp; Upload Sheet Satuan
                        </h3>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                          Gunakan jalur ini jika file belum digabung dalam satu workbook atau ingin mengatur parameter, rasio Auto-Cut, dan komponen Assembly secara terpisah.
                        </p>
                      </div>
                      <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                        <Wrench className="w-4 h-4" />
                      </div>
                    </div>

                    <ul className="space-y-2.5 text-xs text-slate-600 pt-1">
                      <li className="flex items-start gap-2">
                        <span className="font-mono-num font-bold text-slate-400">01.</span>
                        <span>Isi Assy No, Customer, CCT, LOT, dan Metode Allowance langsung dengan navigasi <span className="font-mono-num font-semibold text-slate-700">Enter ↵</span>.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="font-mono-num font-bold text-slate-400">02.</span>
                        <span>Upload terpisah &amp; lihat pratinjau penuh <strong className="text-slate-800">PART LIST</strong>, <strong className="text-slate-800">PPCS</strong>, <strong className="text-slate-800">Assembly COT</strong>, dan <strong className="text-slate-800">MARKER LIST</strong>.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="font-mono-num font-bold text-slate-400">03.</span>
                        <span>Kendalikan rasio terminal Auto-Cut per part number serta penyesuaian manual komponen Assembly bila diperlukan.</span>
                      </li>
                    </ul>
                  </div>

                  <div className="pt-4 border-t border-slate-200/80 space-y-2.5">
                    <button
                      type="button"
                      onClick={() => setEntryMode('manual')}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-slate-300 text-slate-800 text-xs font-semibold hover:bg-slate-100 hover:border-slate-400 transition-colors cursor-pointer"
                    >
                      <span>Buka Mode Input Manual</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </section>
              </div>
            </div>
          ) : (
            /* Persistent Enter-key navigation container shared by Template & Manual views */
            <div ref={formContainerRef} className="p-5">
              {entryMode === 'template' ? (
                /* VIEW 2: Streamlined Template Mode (Primary) */
                <div className="rounded-xl border border-slate-200 bg-white grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
                  {/* Left: Parameter & Allowance Configuration */}
                  <section className="xl:col-span-5 p-5 flex flex-col justify-between gap-4">
                    <div className="space-y-4">
                      <div className="pb-3 border-b border-slate-100 flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">
                            01. Konfirmasi Identitas &amp; Parameter Assy
                          </h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Terisi otomatis dari header PART LIST; Allowance &amp; Kesulitan diatur setelah kalkulasi.
                          </p>
                        </div>
                        <span
                          title="Tekan Enter untuk lanjut ke kolom berikutnya, Shift+Enter untuk mundur"
                          className={`text-[10px] font-mono-num font-semibold border px-2 py-0.5 rounded-md whitespace-nowrap shrink-0 transition-colors ${
                            activeFieldIndex >= 0
                              ? 'text-[#1E3A8A] bg-blue-50 border-blue-200'
                              : 'text-slate-500 bg-slate-100 border-slate-200'
                          }`}
                        >
                          {activeFieldIndex >= 0 && totalFields > 0
                            ? `Kolom ${activeFieldIndex + 1}/${totalFields} · Enter ↵`
                            : 'Enter ↵ lanjut'}
                        </span>
                      </div>

                      {renderParameterInputs()}
                    </div>

                    <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-500">
                      Semua data Part List, PPCS, Assembly COT, dan Marker akan tersimpan bersama parameter ini saat kalkulasi dijalankan.
                    </div>
                  </section>

                  {/* Right: Auto-Extracted Sheets Preview + Validated Assembly Summary */}
                  <section className="xl:col-span-7 p-5 flex flex-col justify-between gap-5">
                    <div className="space-y-5">
                      {/* 4 Sheet Dataset Summary & Preview Table */}
                      <div>
                        <div className="pb-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-bold text-slate-900">
                              02. Data Sheet Terbaca &amp; Pratinjau
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                              Periksa isi Part List, PPCS, Assembly COT, dan Marker List hasil ekstraksi template.
                            </p>
                          </div>
                        </div>

                        <div className="divide-y divide-slate-100 mt-1">
                          {/* PART LIST row */}
                          <div className="py-2.5 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-900">
                                PART LIST
                                {templateImportReport?.plSheetName && (
                                  <span className="font-mono-num font-normal text-slate-500">
                                    {' '}· {templateImportReport.plSheetName}
                                  </span>
                                )}
                              </p>
                              <p className="text-[11px] font-mono-num text-slate-500 mt-0.5">
                                {partList.length > 0
                                  ? `${plSummary.rows} item · ${plSummary.uniqAc} Auto-Cut · ${plSummary.uniqAf} Feeder · ${plSummary.housingConnQty} Conn H · ${plSummary.jSum} Joint`
                                  : 'Belum dimuat — upload workbook template di atas'}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={partList.length === 0}
                              onClick={() => setPreviewTarget('partlist')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Lihat</span>
                            </button>
                          </div>

                          {/* PPCS row */}
                          <div className="py-2.5 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-900">
                                PPCS (Wire List)
                                {templateImportReport?.ppcsSheetName && (
                                  <span className="font-mono-num font-normal text-slate-500">
                                    {' '}· {templateImportReport.ppcsSheetName}
                                  </span>
                                )}
                              </p>
                              <p className="text-[11px] font-mono-num text-slate-500 mt-0.5">
                                {ppcsList.length > 0
                                  ? `${ppcsSummary.total} sirkuit · ${ppcsSummary.ac} Auto-Cut · ${ppcsSummary.tw} Twist · ${ppcsSummary.sh} Shield`
                                  : 'Belum dimuat'}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={ppcsList.length === 0}
                              onClick={() => setPreviewTarget('ppcs')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Lihat</span>
                            </button>
                          </div>

                          {/* COT row */}
                          <div className="py-2.5 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-900">
                                Assembly COT (Master_COT_V2)
                                {templateImportReport?.cotSheetName && (
                                  <span className="font-mono-num font-normal text-slate-500">
                                    {' '}· {templateImportReport.cotSheetName}
                                  </span>
                                )}
                              </p>
                              <p className="text-[11px] font-mono-num text-slate-500 mt-0.5">
                                {cotSummary.v2.hasCotV2Rows
                                  ? `${cotSummary.v2.cotV2RowCount} baris (${cotSummary.v2.totalPieces} pcs) · ${cotSummary.v2.totalLengthMm.toLocaleString()} mm · ${cotSummary.v2.totalSec.toFixed(2)} dtk (${cotSummary.v2.totalBaseUmhHr.toFixed(4)} hr)`
                                  : assemblyCotList.length > 0
                                  ? `${cotSummary.count} titik · COT (C): ${cotSummary.cCount} · Taping TL: ${cotSummary.tapingTl.toLocaleString()} mm`
                                  : 'Belum dimuat'}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={assemblyCotList.length === 0}
                              onClick={() => setPreviewTarget('assembly')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Lihat</span>
                            </button>
                          </div>

                          {/* MARKER LIST row */}
                          <div className="py-2.5 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-900">
                                MARKER LIST
                                {templateImportReport?.markerSheetName && (
                                  <span className="font-mono-num font-normal text-slate-500">
                                    {' '}· {templateImportReport.markerSheetName}
                                  </span>
                                )}
                              </p>
                              <p className="text-[11px] font-mono-num text-slate-500 mt-0.5">
                                {markerPreviewItems.items.length > 0
                                  ? `${markerPreviewItems.items.length} baris · Total Qty: ${markerPreviewItems.totalQty} (${
                                      markerPreviewItems.source === 'sheet'
                                        ? 'dari Sheet MARKER LIST'
                                        : 'dari PART LIST'
                                    })`
                                  : `Total Marker (nm): ${assemblyComponents.markerQty}`}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={markerPreviewItems.items.length === 0}
                              onClick={() => setPreviewTarget('marker')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Lihat</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Auto-Validated Assembly Components Readout */}
                      <div className="pt-3 border-t border-slate-200 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-xs font-bold text-slate-900">
                            03. Komponen Assembly Tervalidasi Otomatis
                          </h4>
                          <span className="text-[11px] font-medium text-[#047857]">
                            Tervalidasi dari Template
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-5 border border-slate-200 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-slate-50/70">
                          <div className="px-3 py-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              Marker (nm)
                            </p>
                            <p className="text-base font-bold font-mono-num tabular-nums text-slate-900 mt-0.5">
                              {assemblyComponents.markerQty}
                            </p>
                          </div>
                          <div className="px-3 py-2.5 bg-emerald-50/50">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                              Spot Tape (ns)
                            </p>
                            <p className="text-base font-bold font-mono-num tabular-nums text-emerald-900 mt-0.5">
                              {assemblyComponents.spotTapeQty}
                            </p>
                          </div>
                          <div className="px-3 py-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              Name Plate (nn)
                            </p>
                            <p className="text-base font-bold font-mono-num tabular-nums text-slate-900 mt-0.5">
                              {assemblyComponents.namePlateQty}
                            </p>
                          </div>
                          <div className="px-3 py-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              Clip (nx)
                            </p>
                            <p className="text-base font-bold font-mono-num tabular-nums text-slate-900 mt-0.5">
                              {assemblyComponents.clipQty}
                            </p>
                          </div>
                          <div className="px-3 py-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              Clamp (ny)
                            </p>
                            <p className="text-base font-bold font-mono-num tabular-nums text-slate-900 mt-0.5">
                              {assemblyComponents.clampQty}
                            </p>
                          </div>
                        </div>

                        {/* Explicit Spot Tape Formula Audit */}
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[11px] text-slate-600 space-y-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-slate-800">
                              Rincian Estimasi Spot Tape (Tape warna non-Black ÷ {SPOT_TAPE_LENGTH_M} m/spot)
                            </span>
                            <span className="font-mono-num font-bold text-[#047857]">
                              {spotTapeSummary.totalMeters > 0
                                ? `ceil(${spotTapeSummary.totalMeters.toFixed(2)} m ÷ 0.2) = ${spotTapeSummary.spotCount} spot`
                                : '0.00 m → 0 spot'}
                            </span>
                          </div>
                          {spotTapeSummary.matchedItems.length > 0 ? (
                            <p className="font-mono-num text-[11px] text-slate-600 leading-relaxed">
                              Terhitung ({spotTapeSummary.matchedItems.length} item):{' '}
                              {spotTapeSummary.matchedItems
                                .map(
                                  (m) =>
                                    `${m.partNumber} [${m.colorCode}: ${m.meters.toFixed(2)}m]`
                                )
                                .join(' · ')}
                            </p>
                          ) : (
                            <p className="text-slate-500">
                              {partList.length === 0
                                ? 'Upload template untuk menghitung estimasi Spot Tape dari Part List.'
                                : 'Tidak ada item Tape berinisial warna non-Black (B) di Part List; item Tape hitam (B), Tape OK, dan tanpa kode warna dikecualikan.'}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-slate-500">
                        Perlu sesuaikan rasio Auto-Cut ({candidateTerminals.length} terminal) atau ubah angka komponen manual?
                      </span>
                      <button
                        type="button"
                        onClick={() => setEntryMode('manual')}
                        className="inline-flex items-center gap-1 text-[#1E3A8A] font-semibold hover:underline cursor-pointer"
                      >
                        <span>Buka Mode Manual</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </section>
                </div>
              ) : (
                /* VIEW 3: Full 3-Section Landscape Manual Workspace (Secondary) */
                <div className="rounded-xl border border-slate-200 bg-white grid grid-cols-1 xl:grid-cols-3 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
                  {/* SEKAT 1: Parameter & Identitas Assy */}
                  <section className="p-5 flex flex-col justify-between gap-4">
                    <div className="space-y-4">
                      <div className="pb-3 border-b border-slate-100 flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">
                            01. Parameter &amp; Identitas Assy
                          </h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Identitas Assy, jumlah CCT, dan LOT.
                          </p>
                        </div>
                        <span
                          title="Tekan Enter untuk lanjut ke kolom berikutnya, Shift+Enter untuk mundur"
                          className={`text-[10px] font-mono-num font-semibold border px-2 py-0.5 rounded-md whitespace-nowrap shrink-0 transition-colors ${
                            activeFieldIndex >= 0
                              ? 'text-[#1E3A8A] bg-blue-50 border-blue-200'
                              : 'text-slate-500 bg-slate-100 border-slate-200'
                          }`}
                        >
                          {activeFieldIndex >= 0 && totalFields > 0
                            ? `Kolom ${activeFieldIndex + 1}/${totalFields} · Enter ↵`
                            : 'Enter ↵ lanjut'}
                        </span>
                      </div>

                      {renderParameterInputs()}
                    </div>

                    <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-500 font-mono-num space-y-1">
                      <div className="flex items-center justify-between">
                        <span>PART LIST</span>
                        <strong className={partList.length > 0 ? 'text-emerald-700' : 'text-slate-400'}>
                          {partList.length} item
                        </strong>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>PPCS Wire List</span>
                        <strong className={ppcsList.length > 0 ? 'text-emerald-700' : 'text-slate-400'}>
                          {ppcsList.length} sirkuit
                        </strong>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Assembly COT</span>
                        <strong className={assemblyCotList.length > 0 ? 'text-emerald-700' : 'text-slate-400'}>
                          {assemblyCotList.length} titik
                        </strong>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>MARKER LIST</span>
                        <strong
                          className={
                            markerPreviewItems.items.length > 0 || assemblyComponents.markerQty > 0
                              ? 'text-emerald-700'
                              : 'text-slate-400'
                          }
                        >
                          {markerPreviewItems.items.length} baris (Qty {assemblyComponents.markerQty})
                        </strong>
                      </div>
                    </div>
                  </section>

                  {/* SEKAT 2: Part List, PPCS & Rasio Auto-Cut */}
                  <section className="p-5 flex flex-col gap-4">
                    <div className="pb-3 border-b border-slate-100">
                      <h3 className="text-sm font-bold text-slate-900">
                        02. Part List, PPCS &amp; Rasio Auto-Cut
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Upload manual terpisah atau pratinjau data hasil template, lalu atur rasio terminal.
                      </p>
                    </div>

                    {/* PART LIST Compact Upload Row */}
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const f = e.dataTransfer.files?.[0];
                        if (f) void handlePartListUpload(f);
                      }}
                      className="pb-3.5 border-b border-slate-100 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-800">File PART LIST</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => partListInputRef.current?.click()}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1E3A8A] text-white text-[11px] font-semibold hover:bg-[#172E6E] cursor-pointer whitespace-nowrap"
                          >
                            <UploadCloud className="w-3.5 h-3.5" />
                            <span>Upload</span>
                          </button>
                          <button
                            type="button"
                            disabled={partList.length === 0}
                            onClick={() => setPreviewTarget('partlist')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Lihat</span>
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] font-mono-num text-slate-500">
                        {plSummary.rows} Baris · {plSummary.uniqAc} Auto-Cut · {plSummary.uniqAf} Feeder ·{' '}
                        {plSummary.housingConnQty} Conn H · {plSummary.jSum} Joint
                      </p>
                    </div>

                    {/* PPCS Compact Upload Row */}
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const f = e.dataTransfer.files?.[0];
                        if (f) void handlePpcsUpload(f);
                      }}
                      className="pb-3.5 border-b border-slate-100 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-800">File PPCS (Wire List)</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => ppcsInputRef.current?.click()}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1E3A8A] text-white text-[11px] font-semibold hover:bg-[#172E6E] cursor-pointer whitespace-nowrap"
                          >
                            <UploadCloud className="w-3.5 h-3.5" />
                            <span>Upload</span>
                          </button>
                          <button
                            type="button"
                            disabled={ppcsList.length === 0}
                            onClick={() => setPreviewTarget('ppcs')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Lihat</span>
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] font-mono-num text-slate-500">
                        {ppcsSummary.total} Sirkuit · {ppcsSummary.ac} Auto-Cut · {ppcsSummary.tw} Twist ·{' '}
                        {ppcsSummary.sh} Shield
                      </p>
                    </div>

                    {/* Terminal Auto-Cut Ratio Allocator */}
                    <div className="space-y-2.5 flex-1 flex flex-col min-h-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Sliders className="w-3.5 h-3.5 text-[#1E3A8A] shrink-0" />
                          <span className="text-xs font-bold text-slate-800 truncate">
                            Rasio Auto-Cut ({candidateTerminals.length})
                          </span>
                        </div>

                        {candidateTerminals.length > 0 && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={applyAllRatio}
                              onChange={(e) => setApplyAllRatio(Number(e.target.value))}
                              className="w-14 text-right font-mono-num text-xs px-2 py-1 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/25 focus:border-[#1E3A8A] transition-colors"
                            />
                            <span className="text-[11px] text-slate-500">%</span>
                            <button
                              type="button"
                              onClick={handleApplyAllRatio}
                              className="px-2 py-1 rounded-md bg-slate-900 text-white text-[11px] font-semibold hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                            >
                              Semua
                            </button>
                          </div>
                        )}
                      </div>

                      {candidateTerminals.length === 0 ? (
                        <p className="text-[11px] text-slate-500 py-2">
                          Belum ada terminal kandidat Auto-Cut terdeteksi dari PPCS.
                        </p>
                      ) : (
                        <div className="max-h-[210px] overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
                          {candidateTerminals.map((item) => {
                            const val = terminalRatios[item.partNo] ?? 100;
                            return (
                              <div
                                key={item.partNo}
                                className="px-3 py-2 flex items-center justify-between gap-2 bg-slate-50/60 focus-within:bg-blue-50/40 transition-colors"
                              >
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold font-mono-num text-slate-900 truncate">
                                    {item.partNo}
                                  </p>
                                  <p className="text-[11px] text-slate-500 font-mono-num">
                                    {item.count} ujung
                                  </p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="1"
                                    value={val}
                                    onChange={(e) =>
                                      setTerminalRatios({
                                        ...terminalRatios,
                                        [item.partNo]: Math.max(0, Math.min(100, Number(e.target.value))),
                                      })
                                    }
                                    className="w-16 text-right font-mono-num text-xs font-semibold px-2 py-1 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/25 focus:border-[#1E3A8A] transition-colors"
                                  />
                                  <span className="text-[11px] text-slate-500 font-semibold">%</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </section>

                  {/* SEKAT 3: Assembly COT, Marker & Komponen Assembly */}
                  <section className="p-5 flex flex-col gap-4">
                    <div className="pb-3 border-b border-slate-100">
                      <h3 className="text-sm font-bold text-slate-900">
                        03. Assembly COT, Marker &amp; Komponen
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Upload &amp; pratinjau sheet COT (Master_COT_V2) dan MARKER LIST, lalu cek komponen.
                      </p>
                    </div>

                    {/* Assembly COT Upload */}
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const f = e.dataTransfer.files?.[0];
                        if (f) void handleCotUpload(f);
                      }}
                      className="pb-3 border-b border-slate-100 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-800">File Sheet COT / Assembly</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => cotInputRef.current?.click()}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1E3A8A] text-white text-[11px] font-semibold hover:bg-[#172E6E] cursor-pointer whitespace-nowrap"
                          >
                            <UploadCloud className="w-3.5 h-3.5" />
                            <span>Upload</span>
                          </button>
                          <button
                            type="button"
                            disabled={assemblyCotList.length === 0}
                            onClick={() => setPreviewTarget('assembly')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Lihat</span>
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] font-mono-num text-slate-500">
                        {cotSummary.v2.hasCotV2Rows ? (
                          <>
                            {cotSummary.v2.cotV2RowCount} Baris ({cotSummary.v2.totalPieces} pcs) ·{' '}
                            {cotSummary.v2.totalLengthMm.toLocaleString()} mm ·{' '}
                            <span className="text-emerald-700 font-semibold">
                              {cotSummary.v2.totalSec.toFixed(2)} dtk ({cotSummary.v2.totalBaseUmhHr.toFixed(4)} hr)
                            </span>
                          </>
                        ) : (
                          <>
                            {cotSummary.count} Titik · COT (C): {cotSummary.cCount} · Taping TL:{' '}
                            {cotSummary.tapingTl.toLocaleString()} mm
                          </>
                        )}
                      </p>
                    </div>

                    {/* MARKER LIST Upload & Preview Row */}
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const f = e.dataTransfer.files?.[0];
                        if (f) void handleMarkerUpload(f);
                      }}
                      className="pb-3 border-b border-slate-100 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-800">File Sheet MARKER LIST</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => markerInputRef.current?.click()}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1E3A8A] text-white text-[11px] font-semibold hover:bg-[#172E6E] cursor-pointer whitespace-nowrap"
                          >
                            <UploadCloud className="w-3.5 h-3.5" />
                            <span>Upload</span>
                          </button>
                          <button
                            type="button"
                            disabled={markerPreviewItems.items.length === 0}
                            onClick={() => setPreviewTarget('marker')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Lihat</span>
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] font-mono-num text-slate-500">
                        {markerPreviewItems.items.length > 0
                          ? `${markerPreviewItems.items.length} Baris · Total Qty: ${markerPreviewItems.totalQty} (${
                              markerPreviewItems.source === 'sheet'
                                ? 'Sheet MARKER LIST'
                                : 'Dari PART LIST'
                            })`
                          : 'Belum ada item Marker — upload sheet MARKER LIST atau PART LIST'}
                      </p>
                    </div>

                    {/* Assembly Components (Auto-Validated + Manual Override) */}
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-800">
                          Komponen Assembly (Auto-Validasi / Manual)
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <label className="block space-y-1">
                          <span className="text-xs font-semibold text-slate-700">Marker (nm)</span>
                          <input
                            type="number"
                            min="0"
                            value={assemblyComponents.markerQty}
                            onChange={(e) =>
                              setAssemblyComponents({
                                ...assemblyComponents,
                                markerQty: Math.max(0, Number(e.target.value)),
                              })
                            }
                            className="w-full px-3 py-1.5 text-sm font-mono-num bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/25 focus:border-[#1E3A8A] transition-colors"
                          />
                        </label>

                        <label className="block space-y-1">
                          <span className="text-xs font-semibold text-slate-700">Spot Tape (ns)</span>
                          <input
                            type="number"
                            min="0"
                            value={assemblyComponents.spotTapeQty}
                            onChange={(e) =>
                              setAssemblyComponents({
                                ...assemblyComponents,
                                spotTapeQty: Math.max(0, Number(e.target.value)),
                              })
                            }
                            className="w-full px-3 py-1.5 text-sm font-mono-num bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/25 focus:border-[#1E3A8A] transition-colors"
                          />
                        </label>

                        <label className="block space-y-1">
                          <span className="text-xs font-semibold text-slate-700">Name Plate (nn)</span>
                          <input
                            type="number"
                            min="0"
                            value={assemblyComponents.namePlateQty}
                            onChange={(e) =>
                              setAssemblyComponents({
                                ...assemblyComponents,
                                namePlateQty: Math.max(0, Number(e.target.value)),
                              })
                            }
                            className="w-full px-3 py-1.5 text-sm font-mono-num bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/25 focus:border-[#1E3A8A] transition-colors"
                          />
                        </label>

                        <label className="block space-y-1">
                          <span className="text-xs font-semibold text-slate-700">Clip (nx)</span>
                          <input
                            type="number"
                            min="0"
                            value={assemblyComponents.clipQty}
                            onChange={(e) =>
                              setAssemblyComponents({
                                ...assemblyComponents,
                                clipQty: Math.max(0, Number(e.target.value)),
                              })
                            }
                            className="w-full px-3 py-1.5 text-sm font-mono-num bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/25 focus:border-[#1E3A8A] transition-colors"
                          />
                        </label>

                        <label className="block space-y-1 col-span-2">
                          <span className="text-xs font-semibold text-slate-700">Clamp (ny)</span>
                          <input
                            type="number"
                            min="0"
                            value={assemblyComponents.clampQty}
                            onChange={(e) =>
                              setAssemblyComponents({
                                ...assemblyComponents,
                                clampQty: Math.max(0, Number(e.target.value)),
                              })
                            }
                            className="w-full px-3 py-1.5 text-sm font-mono-num bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/25 focus:border-[#1E3A8A] transition-colors"
                          />
                        </label>
                      </div>

                      {partList.length > 0 && (
                        <div className="pt-1 flex items-center justify-between gap-2 text-[11px] font-mono-num text-slate-600">
                          <span className="truncate">
                            Spot Tape PL: {spotTapeSummary.totalMeters.toFixed(2)} m non-B ÷ 0.2 ={' '}
                            <strong className="text-emerald-700">{spotTapeSummary.spotCount} spot</strong>
                          </span>
                          {spotTapeSummary.spotCount !== assemblyComponents.spotTapeQty && (
                            <button
                              type="button"
                              onClick={() =>
                                setAssemblyComponents((prev) => ({
                                  ...prev,
                                  spotTapeQty: spotTapeSummary.spotCount,
                                }))
                              }
                              className="text-[#1E3A8A] font-sans font-semibold hover:underline cursor-pointer shrink-0"
                            >
                              Terapkan
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3">
          {entryMode === 'choose' ? (
            <>
              <p className="text-xs text-slate-500">
                Jalur utama disarankan: <strong className="text-slate-800">Upload Template UMH</strong> (sheet PART LIST / PL NEW ASSY, PPCS, MARKER LIST, COT).
              </p>
              <button
                type="button"
                onClick={handleRequestClose}
                className="px-4 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
              >
                Batal
              </button>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono-num">
                <span>
                  {assyNo || 'Assy belum diisi'} · CCT {parsedMasterCct || '-'} · LOT {parsedLot || '-'}
                </span>
                {duplicateMatch && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 font-sans font-semibold text-[11px]">
                    <AlertTriangle className="w-3 h-3 text-amber-700" />
                    <span>Duplikat</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleRequestClose}
                  className="px-4 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                >
                  Batal
                </button>
                <button
                  ref={submitButtonRef}
                  type="button"
                  onClick={handleSubmit}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#1E3A8A] text-white text-xs font-semibold hover:bg-[#172E6E] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1E3A8A] cursor-pointer whitespace-nowrap transition-shadow shadow-xs"
                >
                  <span>Hitung &amp; Preview Hasil</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}
        </div>

        {/* Raw Data Preview Sub-Overlay */}
        {previewTarget && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-6">
            <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[82vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    {previewTarget === 'partlist'
                      ? `Preview PART LIST (${partList.length} baris)`
                      : previewTarget === 'ppcs'
                      ? `Preview PPCS Wire List (${ppcsList.length} sirkuit)`
                      : previewTarget === 'marker'
                      ? `Preview MARKER LIST (${markerPreviewItems.items.length} baris · Total Qty ${markerPreviewItems.totalQty})`
                      : `Preview Assembly COT & Drawing (${assemblyCotList.length} titik)`}
                  </h4>
                  {previewTarget === 'marker' && (
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Sumber data:{' '}
                      {markerPreviewItems.source === 'sheet'
                        ? 'Sheet MARKER LIST'
                        : 'Filter PART LIST (Marker)'}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewTarget(null)}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                  aria-label="Tutup Preview"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4">
                {previewTarget === 'partlist' && (
                  <div className="space-y-3">
                    {spotTapeSummary.matchedItems.length > 0 && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3.5 py-2 text-xs text-emerald-950 flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <strong>Spot Tape Terdeteksi</strong> (Tape warna non-Black berinisial warna di akhir Part No):{' '}
                          <span className="font-mono-num">
                            {spotTapeSummary.matchedItems.length} item · {spotTapeSummary.totalMeters.toFixed(2)} m ÷ 0.2 m
                          </span>
                        </span>
                        <span className="font-mono-num font-bold text-emerald-800">
                          = {spotTapeSummary.spotCount} spot
                        </span>
                      </div>
                    )}
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2 px-2">No</th>
                          <th className="py-2 px-2">Customer</th>
                          <th className="py-2 px-2">Assy No</th>
                          <th className="py-2 px-2">Part Number</th>
                          <th className="py-2 px-2">Part Name</th>
                          <th className="py-2 px-2 text-right">Qty</th>
                          <th className="py-2 px-2">Unit</th>
                          <th className="py-2 px-2 text-right">Routing ID</th>
                          <th className="py-2 px-2">Status / Keterangan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {partList.slice(0, 450).map((r, i) => {
                          const spotEval = evaluateSpotTapePartItem(r);
                          return (
                            <tr
                              key={i}
                              className={spotEval.qualified ? 'bg-emerald-50/70' : undefined}
                            >
                              <td className="py-1.5 px-2 font-mono-num">{i + 1}</td>
                              <td className="py-1.5 px-2">{r.customer}</td>
                              <td className="py-1.5 px-2 font-mono-num">{r.assyNo}</td>
                              <td className="py-1.5 px-2 font-mono-num font-medium">
                                {r.partNumber}
                              </td>
                              <td className="py-1.5 px-2">{r.partName}</td>
                              <td className="py-1.5 px-2 text-right font-mono-num">{r.qty}</td>
                              <td className="py-1.5 px-2 font-mono-num text-slate-500">
                                {r.unit || '-'}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono-num">
                                {r.routingId}
                              </td>
                              <td className="py-1.5 px-2 font-medium">
                                {spotEval.qualified ? (
                                  <span className="text-emerald-800 font-semibold">
                                    Spot Tape ({spotEval.colorCode})
                                  </span>
                                ) : r.desc ? (
                                  <span className="text-emerald-700">{r.desc}</span>
                                ) : (
                                  <span className="text-slate-400">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {previewTarget === 'ppcs' && (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 px-2">CCT</th>
                        <th className="py-2 px-2">Kind</th>
                        <th className="py-2 px-2">Size</th>
                        <th className="py-2 px-2">Col</th>
                        <th className="py-2 px-2 text-right">C/L</th>
                        <th className="py-2 px-2">Joint</th>
                        <th className="py-2 px-2">Twist</th>
                        <th className="py-2 px-2">Tube R/F</th>
                        <th className="py-2 px-2">Term R</th>
                        <th className="py-2 px-2">Acc R</th>
                        <th className="py-2 px-2">Term F</th>
                        <th className="py-2 px-2">Acc F</th>
                        <th className="py-2 px-2">Mark / D/C</th>
                        <th className="py-2 px-2">Auto-Cut</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {ppcsList.slice(0, 300).map((r, idx) => (
                        <tr key={idx}>
                          <td className="py-1.5 px-2 font-mono-num font-bold">{r.cctNo}</td>
                          <td className="py-1.5 px-2">{r.kind}</td>
                          <td className="py-1.5 px-2 font-mono-num">{r.sizeRaw}</td>
                          <td className="py-1.5 px-2">{r.colour}</td>
                          <td className="py-1.5 px-2 text-right font-mono-num">{r.cl}</td>
                          <td className="py-1.5 px-2 font-mono-num">{r.jointNo || '-'}</td>
                          <td className="py-1.5 px-2 font-mono-num">{r.twist || '-'}</td>
                          <td className="py-1.5 px-2 font-mono-num">
                            {[r.tubeR, r.tubeF].filter(Boolean).join(' / ') || '-'}
                          </td>
                          <td className="py-1.5 px-2 font-mono-num">{r.termR || '-'}</td>
                          <td className="py-1.5 px-2 font-mono-num">
                            {[r.accR1, r.accR2].filter(Boolean).join(', ') || '-'}
                          </td>
                          <td className="py-1.5 px-2 font-mono-num">{r.termF || '-'}</td>
                          <td className="py-1.5 px-2 font-mono-num">
                            {[r.accF1, r.accF2].filter(Boolean).join(', ') || '-'}
                          </td>
                          <td className="py-1.5 px-2 font-mono-num">
                            {[r.markerR, r.markerF, r.dcR, r.dcF].filter(Boolean).join(' · ') || '-'}
                          </td>
                          <td className="py-1.5 px-2 whitespace-nowrap">
                            {r.rAc ? 'R:Auto ' : ''}
                            {r.fAc ? 'F:Auto' : !r.rAc ? 'Manual' : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {previewTarget === 'marker' && (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 px-2">No</th>
                        <th className="py-2 px-2">Marker / Part No</th>
                        <th className="py-2 px-2">Part Name / Deskripsi</th>
                        <th className="py-2 px-2 text-right">Qty</th>
                        <th className="py-2 px-2">Unit</th>
                        <th className="py-2 px-2">Proses / Supply</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {markerPreviewItems.items.map((m, idx) => (
                        <tr key={idx}>
                          <td className="py-1.5 px-2 font-mono-num">{m.no ?? idx + 1}</td>
                          <td className="py-1.5 px-2 font-mono-num font-medium">{m.partNo}</td>
                          <td className="py-1.5 px-2">{m.partName}</td>
                          <td className="py-1.5 px-2 text-right font-mono-num font-semibold text-slate-900">
                            {m.qty}
                          </td>
                          <td className="py-1.5 px-2 font-mono-num text-slate-500">
                            {m.unit || 'Pcs'}
                          </td>
                          <td className="py-1.5 px-2 text-slate-600">
                            {[m.proses, m.supply].filter(Boolean).join(' · ') || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900">
                        <td colSpan={3} className="py-2 px-2">
                          TOTAL MARKER (nm)
                        </td>
                        <td className="py-2 px-2 text-right font-mono-num">
                          {markerPreviewItems.totalQty}
                        </td>
                        <td colSpan={2} className="py-2 px-2 text-slate-500 font-normal">
                          {markerPreviewItems.source === 'sheet'
                            ? 'Tervalidasi dari Sheet MARKER LIST'
                            : 'Tervalidasi dari PART LIST'}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}

                {previewTarget === 'assembly' && (
                  cotV2Summary.hasCotV2Rows ? (
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2 px-2">No</th>
                          <th className="py-2 px-2">Tube No</th>
                          <th className="py-2 px-2">Tube Name</th>
                          <th className="py-2 px-2">DIA</th>
                          <th className="py-2 px-2 text-right">Length (mm)</th>
                          <th className="py-2 px-2 text-right">Qty</th>
                          <th className="py-2 px-2 text-right">Pre-COT (s)</th>
                          <th className="py-2 px-2 text-right">Ujung (s)</th>
                          <th className="py-2 px-2 text-right">Post-COT (s)</th>
                          <th className="py-2 px-2 text-right">Total (s)</th>
                          <th className="py-2 px-2 text-right">Base UMH (hr)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {cotV2Summary.rows.map((r, i) => (
                          <tr key={i}>
                            <td className="py-1.5 px-2 font-mono-num">{i + 1}</td>
                            <td className="py-1.5 px-2 font-mono-num">{r.row.tubeNo || '-'}</td>
                            <td className="py-1.5 px-2 font-mono-num font-medium">
                              {r.row.tubeName || r.row.partName || '-'}
                            </td>
                            <td className="py-1.5 px-2 font-mono-num font-bold text-[#1E3A8A]">
                              {r.resolvedDia}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono-num">
                              {r.lengthMm.toLocaleString()}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono-num">{r.qty}</td>
                            <td className="py-1.5 px-2 text-right font-mono-num">
                              {r.totalPreSec.toFixed(2)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono-num">
                              {r.totalUjungSec.toFixed(2)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono-num">
                              {r.totalPostSec.toFixed(2)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono-num font-semibold text-slate-900">
                              {r.totalSec.toFixed(2)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono-num text-emerald-700">
                              {r.baseUmhHr.toFixed(4)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900">
                          <td colSpan={4} className="py-2 px-2">
                            TOTAL TAPING COT (Master_COT_V2)
                          </td>
                          <td className="py-2 px-2 text-right font-mono-num">
                            {cotV2Summary.totalLengthMm.toLocaleString()}
                          </td>
                          <td className="py-2 px-2 text-right font-mono-num">
                            {cotV2Summary.totalPieces}
                          </td>
                          <td className="py-2 px-2 text-right font-mono-num">
                            {cotV2Summary.totalPreSec.toFixed(2)}
                          </td>
                          <td className="py-2 px-2 text-right font-mono-num">
                            {cotV2Summary.totalUjungSec.toFixed(2)}
                          </td>
                          <td className="py-2 px-2 text-right font-mono-num">
                            {cotV2Summary.totalPostSec.toFixed(2)}
                          </td>
                          <td className="py-2 px-2 text-right font-mono-num">
                            {cotV2Summary.totalSec.toFixed(2)}
                          </td>
                          <td className="py-2 px-2 text-right font-mono-num text-emerald-700">
                            {cotV2Summary.totalBaseUmhHr.toFixed(4)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  ) : (
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2 px-2">No</th>
                          <th className="py-2 px-2">Type</th>
                          <th className="py-2 px-2">Keterangan</th>
                          <th className="py-2 px-2 text-right">Length TL (mm)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {assemblyCotList.map((r, i) => (
                          <tr key={i}>
                            <td className="py-1.5 px-2 font-mono-num">{i + 1}</td>
                            <td className="py-1.5 px-2 font-mono-num font-bold">{r.type}</td>
                            <td className="py-1.5 px-2">
                              {r.type === 'C'
                                ? 'Corrugated Tube (COT)'
                                : r.type === 'B'
                                ? 'Bare (Non-Taping)'
                                : 'Tape / Taping'}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono-num">{r.tl}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                )}
              </div>
            </div>
          </div>
        )}
        {/* Cancel Confirmation Dialog */}
        {showCancelConfirm && (
          <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/55 backdrop-blur-xs p-4">
            <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Batalkan Input Assy?</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Data atau perubahan yang sedang diinput belum disimpan.
                  </p>
                </div>
              </div>
              <div className="px-5 py-3.5 bg-slate-50 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCancelConfirm(false)}
                  className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  Kembali ke Form
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCancelConfirm(false);
                    onClose();
                  }}
                  className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer"
                >
                  Ya, Batalkan
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
