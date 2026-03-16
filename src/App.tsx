import React, { useState } from 'react';
import { Upload, Settings, Calendar as CalendarIcon, CheckCircle, Play } from 'lucide-react';
import { parseExcel, ParsedData } from './lib/parser';
import { generateSchedule, ScheduleResult } from './lib/scheduler';
import { FileUpload } from './components/FileUpload';
import { ConfigPanel } from './components/ConfigPanel';
import { ScheduleView } from './components/ScheduleView';

export default function App() {
  const [data, setData] = useState<ParsedData | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResult | null>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'config' | 'schedule'>('upload');

  const handleDataChange = (nextData: ParsedData) => {
    setData(nextData);
    setSchedule(null);
  };

  const handleFileUpload = async (file: File) => {
    try {
      const parsed = await parseExcel(file);
      setData(parsed);
      setSchedule(null);
      setActiveTab('config');
    } catch (err) {
      alert('Error parsing file. Please ensure it matches the expected format.');
      console.error(err);
    }
  };

  const handleGenerate = () => {
    if (data) {
      const result = generateSchedule(data);
      setSchedule(result);
      setActiveTab('schedule');
    }
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
                disabled={!schedule}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${!schedule ? 'opacity-50 cursor-not-allowed' : activeTab === 'schedule' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                <CheckCircle className="w-4 h-4 inline-block mr-1.5" />
                Schedule
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
            onClear={() => {
              setData(null);
              setSchedule(null);
              setActiveTab('upload');
            }}
          />
        )}
        {activeTab === 'schedule' && schedule && data && (
          <ScheduleView schedule={schedule} data={data} />
        )}
      </main>
    </div>
  );
}
