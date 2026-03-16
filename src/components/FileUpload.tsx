import React, { useCallback } from 'react';
import { UploadCloud } from 'lucide-react';

interface Props {
  onUpload: (file: File) => void;
}

export function FileUpload({ onUpload }: Props) {
  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onUpload(e.dataTransfer.files[0]);
    }
  }, [onUpload]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files[0]);
    }
  }, [onUpload]);

  return (
    <div className="max-w-2xl mx-auto mt-12">
      <div 
        className="border-2 border-dashed border-slate-300 rounded-2xl p-12 text-center hover:bg-slate-50 transition-colors cursor-pointer"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-upload')?.click()}
      >
        <UploadCloud className="w-12 h-12 text-slate-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-slate-900 mb-1">Upload Availability Excel</h3>
        <p className="text-sm text-slate-500 mb-4">Drag and drop your .xlsx file here, or click to browse</p>
        <input 
          id="file-upload" 
          type="file" 
          accept=".xlsx, .xls" 
          className="hidden" 
          onChange={handleChange} 
        />
        <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
          Select File
        </button>
      </div>
      
      <div className="mt-8 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h4 className="font-medium text-slate-900 mb-2">Expected Format:</h4>
        <ul className="text-sm text-slate-600 space-y-2 list-disc list-inside">
          <li>Row with "Name" column and dates as headers</li>
          <li>Employee names in the "Name" column</li>
          <li>Availability formatted as "9:00-13:00", "13:00-17:00", or "9:00-17:00"</li>
          <li>A row starting with "WEB:" followed by names of web-capable employees</li>
        </ul>
      </div>
    </div>
  );
}
