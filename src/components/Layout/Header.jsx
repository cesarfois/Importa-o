import { FaSignOutAlt, FaBoxes, FaSyncAlt, FaArrowLeft } from 'react-icons/fa';
import { useAuth } from '../../context/AuthContext';

const Header = () => {
    const { logout } = useAuth();

    return (
        <header className="bg-white shadow-sm border-b border-gray-100 px-8 py-5 flex items-center justify-between">
            {/* Left: Title & Subtitle */}
            <div className="flex items-center gap-4">
                <div className="p-3 bg-indigo-50 text-[#4f46e5] rounded-xl shrink-0">
                    <FaBoxes className="text-2xl" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 leading-tight">
                        Painel Compra de Material
                    </h1>
                    <p className="text-sm text-gray-500 mt-0.5">
                        Visão consolidada dos pedidos de compra
                    </p>
                </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-3">
                <a
                    href="http://13.140.173.35/portal"
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-gray-900 transition-colors"
                    title="Voltar ao Portal"
                >
                    <FaArrowLeft className="text-xs" />
                    <span>Voltar ao Portal</span>
                </a>
                <button
                    onClick={() => window.location.reload()}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 hover:text-indigo-700 transition-colors"
                    title="Atualizar Página"
                >
                    <FaSyncAlt className="text-xs" />
                    <span>Atualizar</span>
                </button>
                <button
                    onClick={logout}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
                    title="Sair do Sistema"
                >
                    <FaSignOutAlt className="text-base" />
                    <span>Sair</span>
                </button>
            </div>
        </header>
    );
};

export default Header;
