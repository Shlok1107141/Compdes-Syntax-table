import React, { useState, useMemo } from 'react';
import { Search, Filter, Hash, Download, Binary } from 'lucide-react';
import type { SymbolEntry } from '../types';

interface SymbolTableViewProps {
  symbols: SymbolEntry[];
}

export const SymbolTableView: React.FC<SymbolTableViewProps> = ({ symbols }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStorage, setSelectedStorage] = useState<string>('all');
  const [selectedScope, setSelectedScope] = useState<string>('all');

  const filteredSymbols = useMemo(() => {
    return symbols.filter((sym) => {
      const matchesSearch =
        sym.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sym.type.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStorage = selectedStorage === 'all' || sym.storage_class === selectedStorage;
      const matchesScope = selectedScope === 'all' || sym.scope.toString() === selectedScope;
      return matchesSearch && matchesStorage && matchesScope;
    });
  }, [symbols, searchTerm, selectedStorage, selectedScope]);

  const uniqueStorageClasses = Array.from(new Set(symbols.map((s) => s.storage_class)));
  const uniqueScopes = Array.from(new Set(symbols.map((s) => s.scope))).sort((a, b) => a - b);

  // Compute 32-bit packed word representation:
  // [type: 4 bits] [scope: 8 bits] [storage_class: 4 bits] [offset: 16 bits]
  const computeBitpackedWord = (sym: SymbolEntry): { hex: string; binary: string } => {
    const typeCode = sym.type.includes('*') ? 2 : sym.type.includes('()') ? 3 : sym.type === 'char' ? 1 : 0;
    const storageCode = sym.storage_class === 'global' ? 1 : sym.storage_class === 'static' ? 2 : sym.storage_class === 'param' ? 3 : 0;
    const scopeCode = sym.scope & 0xff;
    const offsetCode = sym.offset & 0xffff;

    // Packed 32-bit uint: (offset << 16) | (storage << 12) | (scope << 4) | type
    const word = ((offsetCode << 16) | (storageCode << 12) | (scopeCode << 4) | (typeCode & 0xf)) >>> 0;
    const hex = '0x' + word.toString(16).toUpperCase().padStart(8, '0');
    return { hex, binary: word.toString(2).padStart(32, '0') };
  };

  const exportToJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(symbols, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', 'symbol_table_export.json');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl backdrop-blur-sm">
      {/* Table Header & Search Controls */}
      <div className="p-4 border-b border-slate-800 bg-slate-900/90 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <Hash className="w-4 h-4 text-indigo-400" />
            <h3 className="text-base font-semibold text-white">Parsed Symbol Table</h3>
            <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-slate-800 text-slate-300 border border-slate-700">
              {filteredSymbols.length} / {symbols.length}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Symbols parsed from source, demonstrating bit-packed 32-bit word allocation.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {/* Search box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search identifier or type..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-44 sm:w-56"
            />
          </div>

          {/* Storage Filter */}
          <div className="flex items-center space-x-1 text-xs">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedStorage}
              onChange={(e) => setSelectedStorage(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 focus:outline-none text-xs"
            >
              <option value="all">All Classes</option>
              {uniqueStorageClasses.map((sc) => (
                <option key={sc} value={sc}>
                  {sc}
                </option>
              ))}
            </select>
          </div>

          {/* Scope Filter */}
          {uniqueScopes.length > 1 && (
            <select
              value={selectedScope}
              onChange={(e) => setSelectedScope(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 focus:outline-none text-xs"
            >
              <option value="all">All Scopes</option>
              {uniqueScopes.map((scope) => (
                <option key={scope} value={scope.toString()}>
                  Scope {scope}
                </option>
              ))}
            </select>
          )}

          {/* Export button */}
          <button
            onClick={exportToJson}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
            title="Export JSON"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto max-h-[420px] scrollbar-thin scrollbar-thumb-slate-700">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-950/80 sticky top-0 z-10 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
            <tr>
              <th className="py-3 px-4">Identifier Name</th>
              <th className="py-3 px-4">Type</th>
              <th className="py-3 px-4">Scope</th>
              <th className="py-3 px-4">Storage Class</th>
              <th className="py-3 px-4">Offset</th>
              <th className="py-3 px-4 text-right">Bit-Packed 32b Word</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {filteredSymbols.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500 font-sans">
                  No matching symbols found.
                </td>
              </tr>
            ) : (
              filteredSymbols.map((sym, idx) => {
                const packed = computeBitpackedWord(sym);
                return (
                  <tr
                    key={`${sym.name}-${sym.scope}-${idx}`}
                    className="hover:bg-slate-800/40 transition-colors group"
                  >
                    <td className="py-2.5 px-4 font-bold text-indigo-300 group-hover:text-indigo-200">
                      {sym.name}
                    </td>
                    <td className="py-2.5 px-4 text-emerald-400 font-medium">
                      {sym.type}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px] border border-slate-700">
                        depth {sym.scope}
                      </span>
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                          sym.storage_class === 'global'
                            ? 'bg-blue-500/10 text-blue-300 border border-blue-500/20'
                            : sym.storage_class === 'static'
                            ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                            : sym.storage_class === 'param'
                            ? 'bg-purple-500/10 text-purple-300 border border-purple-500/20'
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}
                      >
                        {sym.storage_class}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-400">
                      +{sym.offset} B
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <span
                        className="inline-flex items-center space-x-1 px-2 py-1 rounded bg-slate-950 text-cyan-300 border border-slate-800 text-[11px]"
                        title={`32-bit packed word:\nOffset: 16b\nClass: 4b\nScope: 8b\nType: 4b\nBinary: ${packed.binary}`}
                      >
                        <Binary className="w-3 h-3 text-cyan-400" />
                        <span>{packed.hex}</span>
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Info */}
      <div className="p-3 bg-slate-950/60 border-t border-slate-800 text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2">
        <span className="text-slate-400">
          💡 <span className="font-semibold text-slate-300">Bit-Packing Breakdown:</span> [Type: 4b] [Scope: 8b] [Storage Class: 4b] [Offset: 16b] = Single 32-bit integer.
        </span>
        <span className="text-slate-500 font-mono">Replaces 16-24 bytes of unpacked struct padding.</span>
      </div>
    </div>
  );
};
