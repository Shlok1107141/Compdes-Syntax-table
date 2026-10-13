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

  // Exact 32-bit word layout: [type: 4 bits][scope: 8 bits][storage_class: 4 bits][offset: 16 bits]
  const describePackedWord = (sym: SymbolEntry): { hex: string; fields: string } => {
    let word = sym.packed;
    if (word === undefined) {
      const typeCode = sym.type.includes('*') ? 2 : sym.type.includes('()') ? 3 : sym.type === 'char' ? 1 : 0;
      const storageCode = sym.storage_class === 'global' ? 1 : sym.storage_class === 'static' ? 2 : sym.storage_class === 'param' ? 3 : 0;
      const scopeCode = sym.scope & 0xff;
      const offsetCode = sym.offset & 0xffff;
      word = ((typeCode & 0xf) << 28) | ((scopeCode & 0xff) << 20) | ((storageCode & 0xf) << 16) | (offsetCode & 0xffff);
    }
    const unsignedWord = word >>> 0;
    const bits = unsignedWord.toString(2).padStart(32, '0');
    return {
      hex: '0x' + unsignedWord.toString(16).toUpperCase().padStart(8, '0'),
      fields:
        `Type: ${bits.slice(0, 4)} (${unsignedWord >>> 28})\n` +
        `Scope: ${bits.slice(4, 12)} (${(unsignedWord >>> 20) & 0xff})\n` +
        `Class: ${bits.slice(12, 16)} (${(unsignedWord >>> 16) & 0xf})\n` +
        `Offset: ${bits.slice(16)} (${unsignedWord & 0xffff} B)`,
    };
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
    <div className="rounded-xl border-2 border-slate-300 bg-white overflow-hidden shadow-xs">
      {/* Table Header & Search Controls */}
      <div className="p-4 border-b-2 border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <Hash className="w-5 h-5 text-teal-800" />
            <h3 className="text-base font-black text-slate-900 tracking-tight">Parsed Symbol Table</h3>
            <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-bold bg-white text-slate-900 border border-slate-300 shadow-2xs">
              {filteredSymbols.length} / {symbols.length} identifiers
            </span>
          </div>
          <p className="text-xs text-slate-600 font-medium mt-0.5">
            Parsed declarations showing 32-bit bit-packed memory layout per symbol.
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
              className="pl-8 pr-3 py-1.5 text-xs bg-white border-2 border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-700 font-medium w-48 sm:w-56"
            />
          </div>

          {/* Storage Filter */}
          <div className="flex items-center space-x-1 text-xs">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={selectedStorage}
              onChange={(e) => setSelectedStorage(e.target.value)}
              className="bg-white border-2 border-slate-300 text-slate-900 font-bold rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-600 text-xs"
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
              className="bg-white border-2 border-slate-300 text-slate-900 font-bold rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-600 text-xs"
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
            type="button"
            onClick={exportToJson}
            className="p-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 hover:text-slate-900 border-2 border-slate-300 transition-colors shadow-2xs font-bold"
            title="Export JSON"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto max-h-[460px]">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-100 sticky top-0 z-10 border-b-2 border-slate-200 text-slate-700 font-bold uppercase tracking-wider text-[11px]">
            <tr>
              <th className="py-3 px-4">Identifier Name</th>
              <th className="py-3 px-4">Type</th>
              <th className="py-3 px-4">Scope</th>
              <th className="py-3 px-4">Storage Class</th>
              <th className="py-3 px-4">Offset</th>
              <th className="py-3 px-4" title="Uses resolved to this declaration by scoped lookup">Refs</th>
              <th className="py-3 px-4 text-right">Bit-Packed 32b Word</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono">
            {filteredSymbols.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-500 font-sans font-bold">
                  No matching symbols found.
                </td>
              </tr>
            ) : (
              filteredSymbols.map((sym, idx) => {
                const packed = describePackedWord(sym);
                return (
                  <tr
                    key={`${sym.name}-${sym.scope}-${idx}`}
                    className="hover:bg-teal-50/40 transition-colors"
                  >
                    <td className="py-3 px-4 font-bold text-slate-900 text-sm">
                      {sym.name}
                    </td>
                    <td className="py-3 px-4 font-bold text-teal-800 text-xs">
                      {sym.type}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded font-bold bg-slate-100 text-slate-800 text-[11px] border border-slate-300">
                        depth {sym.scope}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                          sym.storage_class === 'global'
                            ? 'bg-teal-100 text-teal-900 border-teal-300'
                            : sym.storage_class === 'static'
                            ? 'bg-orange-100 text-orange-950 border-orange-300'
                            : sym.storage_class === 'param'
                            ? 'bg-blue-100 text-blue-900 border-blue-300'
                            : 'bg-slate-200 text-slate-900 border-slate-300'
                        }`}
                      >
                        {sym.storage_class}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-700">
                      +{sym.offset} B
                    </td>
                    <td className={`py-3 px-4 font-bold ${sym.references ? 'text-slate-900' : 'text-slate-400'}`}>
                      {sym.references ?? '0'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span
                        className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded bg-teal-50 text-teal-950 border border-teal-300 text-xs font-bold shadow-2xs"
                        title={`32-bit packed word fields:\n${packed.fields}`}
                      >
                        <Binary className="w-3.5 h-3.5 text-teal-700" />
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
      <div className="p-3 bg-slate-50 border-t-2 border-slate-200 text-xs text-slate-700 flex flex-wrap items-center justify-between gap-2 font-medium">
        <span>
          💡 <span className="font-extrabold text-slate-900">Bit-Packing Scheme:</span> [Type: 4b] [Scope: 8b] [Storage Class: 4b] [Offset: 16b] = Single 32-bit integer word.
        </span>
        <span className="text-slate-600 font-mono font-bold">Replaces 16 bytes of standard struct pointer padding.</span>
      </div>
    </div>
  );
};
