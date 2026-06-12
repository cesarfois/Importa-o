import React, { useState, useEffect, useCallback } from 'react';
import {
    FaFolder, FaFolderOpen, FaFileAlt, FaFileCsv, FaDownload,
    FaChevronRight, FaHome, FaSync, FaDatabase, FaFile, FaTrash
} from 'react-icons/fa';

const API_BASE = '/api/exports';

// Root folders that are protected and cannot be deleted
const PROTECTED_FOLDERS = [
    'Exportações CSV',
    'Histórico de exportações SQL',
];

// Format bytes to human-readable
const formatSize = (bytes) => {
    if (bytes === 0 || bytes == null) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

// Format ISO date to local
const formatDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
};

// Pick icon by file extension or type
const ItemIcon = ({ item, size = 'text-xl' }) => {
    if (item.type === 'folder') return <FaFolder className={`${size} text-yellow-400`} />;
    const ext = item.name.split('.').pop().toLowerCase();
    if (ext === 'csv') return <FaFileCsv className={`${size} text-green-400`} />;
    if (ext === 'sql') return <FaDatabase className={`${size} text-blue-400`} />;
    if (ext === 'json') return <FaFileAlt className={`${size} text-orange-400`} />;
    return <FaFile className={`${size} text-gray-400`} />;
};

const ExportsFileBrowserPage = () => {
    const [currentPath, setCurrentPath] = useState('');
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [downloading, setDownloading] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null); // path needing confirmation
    const [deleting, setDeleting] = useState(null);

    // Breadcrumb segments from currentPath
    const breadcrumbs = currentPath
        ? currentPath.split('/').filter(Boolean)
        : [];

    const loadFolder = useCallback(async (folderPath) => {
        setLoading(true);
        setError(null);
        try {
            const params = folderPath ? `?path=${encodeURIComponent(folderPath)}` : '';
            const res = await fetch(`${API_BASE}/browse${params}`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `Erro ${res.status}`);
            }
            const data = await res.json();
            setItems(data);
            setCurrentPath(folderPath);
        } catch (err) {
            setError(err.message);
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadFolder('');
    }, [loadFolder]);

    const handleNavigate = (item) => {
        if (item.type !== 'folder') return;
        const newPath = currentPath ? `${currentPath}/${item.name}` : item.name;
        loadFolder(newPath);
    };

    const handleBreadcrumb = (index) => {
        if (index < 0) { // Home
            loadFolder('');
        } else {
            const newPath = breadcrumbs.slice(0, index + 1).join('/');
            loadFolder(newPath);
        }
    };

    const handleDownload = async (item) => {
        const filePath = currentPath ? `${currentPath}/${item.name}` : item.name;
        setDownloading(filePath);
        try {
            const res = await fetch(`${API_BASE}/download?path=${encodeURIComponent(filePath)}`);
            if (!res.ok) throw new Error('Falha no download');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = item.name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            alert(`Erro ao baixar: ${err.message}`);
        } finally {
            setDownloading(null);
        }
    };

    const handleDelete = async (item) => {
        const itemPath = currentPath ? `${currentPath}/${item.name}` : item.name;
        if (deleteConfirm !== itemPath) {
            setDeleteConfirm(itemPath);
            return;
        }
        setDeleting(itemPath);
        setDeleteConfirm(null);
        try {
            const res = await fetch(`${API_BASE}/delete?path=${encodeURIComponent(itemPath)}`, { method: 'DELETE' });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `Erro ${res.status}`);
            }
            await loadFolder(currentPath); // refresh
        } catch (err) {
            alert(`Erro ao deletar: ${err.message}`);
        } finally {
            setDeleting(null);
        }
    };

    // Sort: folders first, then files — both alphabetically
    const sorted = [...items].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    return (
        <div className="p-6 max-w-[95%] mx-auto space-y-6">

            {/* Page Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-base-200 rounded-full">
                        <FaFolderOpen className="w-8 h-8 text-yellow-400" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-base-content">Arquivos Exportados</h1>
                        <p className="text-base-content/60 mt-1">
                            Navegue e baixe os arquivos gerados pelas exportações agendadas.
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => loadFolder(currentPath)}
                    className="btn btn-ghost btn-sm gap-2"
                    title="Recarregar"
                >
                    <FaSync className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Breadcrumb */}
            <div className="flex items-center flex-wrap gap-1 text-sm bg-base-200 rounded-xl px-4 py-2">
                <button
                    onClick={() => handleBreadcrumb(-1)}
                    className="flex items-center gap-1 hover:text-primary transition-colors font-medium"
                >
                    <FaHome className="text-xs" />
                    <span>Exportações</span>
                </button>
                {breadcrumbs.map((crumb, i) => (
                    <React.Fragment key={i}>
                        <FaChevronRight className="text-xs text-base-content/40" />
                        <button
                            onClick={() => handleBreadcrumb(i)}
                            className={`hover:text-primary transition-colors ${i === breadcrumbs.length - 1
                                ? 'text-primary font-semibold'
                                : 'text-base-content/70'
                                }`}
                        >
                            {decodeURIComponent(crumb)}
                        </button>
                    </React.Fragment>
                ))}
            </div>

            {/* Content Card */}
            <div className="card bg-base-100 shadow-xl">
                <div className="card-body p-0">

                    {/* Loading State */}
                    {loading && (
                        <div className="flex items-center justify-center py-20">
                            <span className="loading loading-spinner loading-lg text-primary"></span>
                        </div>
                    )}

                    {/* Error State */}
                    {!loading && error && (
                        <div className="flex flex-col items-center justify-center py-20 gap-3">
                            <div className="text-error text-5xl">⚠️</div>
                            <p className="text-error font-semibold">{error}</p>
                            <button className="btn btn-sm btn-outline" onClick={() => loadFolder(currentPath)}>
                                Tentar novamente
                            </button>
                        </div>
                    )}

                    {/* Empty State */}
                    {!loading && !error && sorted.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 gap-3 text-base-content/50">
                            <FaFolderOpen className="text-6xl text-yellow-300/40" />
                            <p className="text-lg">Pasta vazia</p>
                            <p className="text-sm">Nenhum arquivo ou pasta encontrado.</p>
                        </div>
                    )}

                    {/* File Table */}
                    {!loading && !error && sorted.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="table table-zebra w-full">
                                <thead>
                                    <tr className="border-b border-base-200">
                                        <th className="text-xs uppercase text-base-content/50 font-semibold pl-6">Nome</th>
                                        <th className="text-xs uppercase text-base-content/50 font-semibold text-right">Tamanho</th>
                                        <th className="text-xs uppercase text-base-content/50 font-semibold">Modificado em</th>
                                        <th className="text-xs uppercase text-base-content/50 font-semibold text-center">Ação</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sorted.map((item) => {
                                        const filePath = currentPath ? `${currentPath}/${item.name}` : item.name;
                                        const isDownloading = downloading === filePath;
                                        return (
                                            <tr
                                                key={item.name}
                                                className={`group transition-colors ${item.type === 'folder' ? 'cursor-pointer hover:bg-base-200' : 'hover:bg-base-200/50'}`}
                                                onClick={() => item.type === 'folder' && handleNavigate(item)}
                                            >
                                                {/* Name */}
                                                <td className="pl-6">
                                                    <div className="flex items-center gap-3">
                                                        <ItemIcon item={item} />
                                                        <span className={`font-medium ${item.type === 'folder' ? 'text-base-content group-hover:text-primary transition-colors' : 'text-base-content/80'}`}>
                                                            {item.name}
                                                        </span>
                                                        {item.type === 'folder' && (
                                                            <FaChevronRight className="text-xs text-base-content/30 group-hover:text-primary transition-colors" />
                                                        )}
                                                    </div>
                                                </td>

                                                {/* Size */}
                                                <td className="text-right text-sm text-base-content/60 font-mono">
                                                    {item.type === 'folder' ? '—' : formatSize(item.size)}
                                                </td>

                                                {/* Date */}
                                                <td className="text-sm text-base-content/60">
                                                    {formatDate(item.modified)}
                                                </td>

                                                {/* Action */}
                                                <td className="text-center" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex items-center justify-center gap-1.5">
                                                        {item.type === 'file' && (
                                                            <button
                                                                className="btn btn-xs btn-primary gap-1"
                                                                onClick={() => handleDownload(item)}
                                                                disabled={isDownloading}
                                                                title={`Baixar ${item.name}`}
                                                            >
                                                                {isDownloading
                                                                    ? <span className="loading loading-spinner loading-xs"></span>
                                                                    : <FaDownload />
                                                                }
                                                                Baixar
                                                            </button>
                                                        )}
                                                        {/* Hide delete for protected root folders */}
                                                        {!(currentPath === '' && PROTECTED_FOLDERS.includes(item.name)) && (
                                                            <button
                                                                className={`btn btn-xs gap-1 ${deleteConfirm === filePath
                                                                        ? 'btn-error animate-pulse'
                                                                        : 'btn-ghost text-error/60 hover:text-error hover:bg-error/10'
                                                                    }`}
                                                                onClick={() => handleDelete(item)}
                                                                disabled={deleting === filePath}
                                                                title={`Deletar ${item.name}`}
                                                                onBlur={() => setTimeout(() => setDeleteConfirm(null), 200)}
                                                            >
                                                                {deleting === filePath
                                                                    ? <span className="loading loading-spinner loading-xs"></span>
                                                                    : <FaTrash className="text-[10px]" />
                                                                }
                                                                {deleteConfirm === filePath ? 'Confirmar?' : ''}
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>

                            {/* Footer count */}
                            <div className="px-6 py-3 border-t border-base-200 text-xs text-base-content/50">
                                {sorted.filter(i => i.type === 'folder').length} pasta(s) ·{' '}
                                {sorted.filter(i => i.type === 'file').length} arquivo(s)
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ExportsFileBrowserPage;
