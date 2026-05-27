import React, { useEffect, useRef, useState } from 'react';
import { Upload, Settings, Calendar as CalendarIcon, CheckCircle, AlertCircle } from 'lucide-react';
import { parseExcel } from './lib/parser';
import type { ParsedData } from './lib/parser';
import type { PlannerMode, ScheduleResult } from './lib/scheduler';
import {
  createSavedRosterSnapshot,
  deserializeSavedRosterSnapshot,
  SAVED_ROSTER_STORAGE_KEY,
  serializeSavedRosterSnapshot,
} from './lib/scheduleEditor';
import { FileUpload } from './components/FileUpload';
import { ConfigPanel } from './components/ConfigPanel';
import { ScheduleView } from './components/ScheduleView';

type ScheduleWorkerResponse =
  | { type: 'result'; schedule: ScheduleResult }
  | { type: 'error'; error: string };

export default function App() {
  const [data, setData] = useState<ParsedData | null>(null);
  const [generatedSchedule, setGeneratedSchedule] = useState<ScheduleResult | null>(null);
  const [activeSchedule, setActiveSchedule] = useState<ScheduleResult | null>(null);
  const [plannerMode, setPlannerMode] = useState<PlannerMode>('fairness');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'config' | 'schedule'>('upload');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const generationWorkerRef = useRef<Worker | null>(null);

  const clearSavedRosterSnapshot = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(SAVED_ROSTER_STORAGE_KEY);
  };

  const stopGeneration = () => {
    generationWorkerRef.current?.terminate();
    generationWorkerRef.current = null;
    setIsGenerating(false);
  };

  useEffect(() => () => {
    generationWorkerRef.current?.terminate();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const snapshot = deserializeSavedRosterSnapshot(
      window.localStorage.getItem(SAVED_ROSTER_STORAGE_KEY)
    );

    if (!snapshot) return;

    setData(snapshot.data);
    setGeneratedSchedule(snapshot.generatedSchedule);
    setActiveSchedule(snapshot.schedule);
    setPlannerMode(snapshot.generatedSchedule.plannerMode);
    setSavedAt(snapshot.savedAt);
    setActiveTab('schedule');
  }, []);

  const handleDataChange = (nextData: ParsedData) => {
    if (isGenerating) {
      stopGeneration();
    }
    setData(nextData);
    setGeneratedSchedule(null);
    setActiveSchedule(null);
    setSavedAt(null);
    clearSavedRosterSnapshot();
    setGenerationError(null);
  };

  const handleFileUpload = async (file: File) => {
    try {
      if (isGenerating) {
        stopGeneration();
      }
      const parsed = await parseExcel(file);
      setData(parsed);
      setGeneratedSchedule(null);
      setActiveSchedule(null);
      setSavedAt(null);
      clearSavedRosterSnapshot();
      setGenerationError(null);
      setActiveTab('config');
    } catch (err) {
      alert('Error parsing file. Please ensure it matches the expected format.');
      console.error(err);
    }
  };

  const handleGenerate = () => {
    if (!data || isGenerating) return;

    setGenerationError(null);
    setIsGenerating(true);
    setSavedAt(null);
    clearSavedRosterSnapshot();

    const worker = new Worker(new URL('./workers/schedule.worker.ts', import.meta.url), {
      type: 'module',
    });

    generationWorkerRef.current?.terminate();
    generationWorkerRef.current = worker;

    worker.onmessage = (event: MessageEvent<ScheduleWorkerResponse>) => {
      if (generationWorkerRef.current !== worker) return;

      if (event.data.type === 'result') {
        setGeneratedSchedule(event.data.schedule);
        setActiveSchedule(event.data.schedule);
        setPlannerMode(event.data.schedule.plannerMode);
        setActiveTab('schedule');
      } else {
        setGenerationError(event.data.error);
      }

      stopGeneration();
    };

    worker.onerror = () => {
      if (generationWorkerRef.current !== worker) return;
      setGenerationError('The schedule could not be generated.');
      stopGeneration();
    };

    worker.postMessage({ data, mode: plannerMode });
  };

  const handleClear = () => {
    if (isGenerating) {
      stopGeneration();
    }
    setData(null);
    setGeneratedSchedule(null);
    setActiveSchedule(null);
    setSavedAt(null);
    clearSavedRosterSnapshot();
    setGenerationError(null);
    setActiveTab('upload');
    setPlannerMode('fairness');
  };

  const handleSaveSchedule = (schedule: ScheduleResult) => {
    if (!data || !generatedSchedule || typeof window === 'undefined') return;

    const nextSavedAt = new Date().toISOString();
    const snapshot = createSavedRosterSnapshot(
      data,
      generatedSchedule,
      schedule,
      nextSavedAt
    );

    window.localStorage.setItem(
      SAVED_ROSTER_STORAGE_KEY,
      serializeSavedRosterSnapshot(snapshot)
    );
    setActiveSchedule(schedule);
    setSavedAt(nextSavedAt);
  };

  const handleResetSchedule = () => {
    if (!generatedSchedule) return;

    clearSavedRosterSnapshot();
    setActiveSchedule(generatedSchedule);
    setSavedAt(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <CalendarIcon className="w-6 h-6 text-indigo-600" />
              <h1 className="text-xl font-semibold tracking-tight">ShiftPlanner Pro</h1>
            </div>
            <nav className="flex space-x-4">
              <button
                onClick={() => setActiveTab('upload')}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${activeTab === 'upload' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                <Upload className="w-4 h-4 inline-block mr-1.5" />
                Upload
              </button>
              <button
                onClick={() => setActiveTab('config')}
                disabled={!data}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${!data ? 'opacity-50 cursor-not-allowed' : activeTab === 'config' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                <Settings className="w-4 h-4 inline-block mr-1.5" />
                Configure
              </button>
              <button
                onClick={() => setActiveTab('schedule')}
                disabled={!activeSchedule}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${!activeSchedule ? 'opacity-50 cursor-not-allowed' : activeTab === 'schedule' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                <CheckCircle className="w-4 h-4 inline-block mr-1.5" />
                Schedule
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {generationError && (
          <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <div>
              <p className="font-medium">Generation failed</p>
              <p className="mt-1 text-rose-700">{generationError}</p>
            </div>
          </div>
        )}
        {activeTab === 'upload' && (
          <div className="space-y-6">
            <FileUpload onUpload={handleFileUpload} />
          </div>
        )}
        {activeTab === 'config' && data && (
          <ConfigPanel 
            data={data} 
            onChange={handleDataChange} 
            onGenerate={handleGenerate}
            plannerMode={plannerMode}
            onPlannerModeChange={setPlannerMode}
            onClear={handleClear}
            isGenerating={isGenerating}
          />
        )}
        {activeTab === 'schedule' && activeSchedule && generatedSchedule && data && (
          <ScheduleView
            schedule={activeSchedule}
            generatedSchedule={generatedSchedule}
            data={data}
            savedAt={savedAt}
            onSaveSchedule={handleSaveSchedule}
            onResetSchedule={handleResetSchedule}
          />
        )}
      </main>

      {isGenerating && (
        <div className="fixed inset-0 z-40 bg-slate-950/20 backdrop-blur-[2px]">
          <div className="mx-auto mt-24 w-full max-w-lg px-4">
            <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
                Schedule
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">
                Generating schedule
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                The planner is running in the background. This may take a moment for larger schedules.
              </p>
              <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full w-full rounded-full bg-[linear-gradient(90deg,#4338ca_0%,#6366f1_45%,#a5b4fc_100%)] animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
