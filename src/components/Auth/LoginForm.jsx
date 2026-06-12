import { useState } from 'react';
import { FaChevronDown } from 'react-icons/fa';
import { authService } from '../../services/authService';
import LoadingSpinner from '../Common/LoadingSpinner';

const LoginForm = () => {
    const [url, setUrl] = useState('');
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            await authService.login(url);
        } catch (err) {
            setError(err.message || 'Falha ao conectar. Verifique a URL.');
            setLoading(false);
        }
    };

    const handleServiceAccountLogin = async () => {
        setError(null);
        setLoading(true);

        try {
            await authService.loginWithServiceAccount();
            const redirectPath = sessionStorage.getItem('redirect_after_login');
            if (redirectPath) {
                sessionStorage.removeItem('redirect_after_login');
                window.location.href = redirectPath;
            } else {
                window.location.href = '/compras';
            }
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Falha ao conectar via Conta de Serviço.');
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full flex flex-col md:flex-row shadow-2xl overflow-hidden">

            {/* Left Panel - Branding */}
            <div className="w-full md:w-1/2 bg-[#0a1e3f] flex flex-col items-center justify-center p-12 text-center relative overflow-hidden">
                <div className="z-10 flex flex-col items-center animate-fade-in-up gap-6 -mt-32">
                    {/* Icon */}
                    <img
                        src="/login-icon-v12.png"
                        alt="RCS Vision Icon"
                        className="w-auto h-32 object-contain drop-shadow-2xl animate-fade-in"
                    />

                    {/* Text Logo */}
                    <img
                        src="/login-text-v18.png"
                        alt="RCS Vision Text"
                        className="w-auto max-w-[80%] object-contain drop-shadow-2xl animate-fade-in-up delay-100"
                    />

                    {/* Tagline */}
                    <p className="text-gray-300 text-lg font-light max-w-md animate-fade-in-up delay-200">
                        Acesse sua visão estratégica de documentos e workflows.
                    </p>
                </div>
            </div>

            {/* Right Panel - Login Form */}
            <div className="w-full md:w-1/2 bg-white flex items-center justify-center p-8 md:p-16">
                <div className="w-full max-w-md space-y-8">
                    <div className="text-center md:text-left">
                        <h2 className="text-3xl font-bold text-[#0a1e3f]">
                            Bem-vindo
                        </h2>
                        <p className="mt-2 text-gray-500">
                            Selecione sua plataforma DocuWare para continuar.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="mt-8 space-y-6">
                        <div className="space-y-4">
                            {/* Platform URL */}
                            <div>
                                <label htmlFor="url" className="text-sm font-medium text-gray-700 block mb-1">
                                    Plataforma DocuWare
                                </label>
                                <div className="relative">
                                    <input
                                        id="url"
                                        name="url"
                                        type="text"
                                        required
                                        value={url}
                                        list="url-options"
                                        onChange={(e) => setUrl(e.target.value)}
                                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-[#00bfff] focus:ring-2 focus:ring-[#00bfff]/20 outline-none transition-all placeholder-gray-400 text-gray-900 bg-white pr-10"
                                        placeholder="https://example.docuware.cloud"
                                    />
                                    <FaChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                </div>
                                <datalist id="url-options">
                                    <option value="https://rcsangola.docuware.cloud/" />
                                    <option value="https://rcs-experience.docuware.cloud/" />
                                </datalist>
                            </div>
                        </div>

                        {error && (
                            <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded">
                                <p className="text-sm text-red-700">{error}</p>
                            </div>
                        )}

                        <div>
                            <button
                                type="submit"
                                disabled={loading}
                                className={`
                                    w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-bold text-white 
                                    bg-[#00bfff] hover:bg-[#00ace6] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#00bfff] 
                                    transition-all duration-200 transform hover:-translate-y-0.5
                                    ${loading ? 'opacity-70 cursor-not-allowed' : ''}
                                `}
                            >
                                {loading ? <LoadingSpinner size="sm" color="white" /> : 'Continuar com DocuWare'}
                            </button>
                        </div>

                        <div className="relative flex py-1 items-center">
                            <div className="flex-grow border-t border-gray-300"></div>
                            <span className="flex-shrink mx-4 text-gray-400 text-xs font-semibold uppercase">ou</span>
                            <div className="flex-grow border-t border-gray-300"></div>
                        </div>

                        <div>
                            <button
                                type="button"
                                onClick={handleServiceAccountLogin}
                                disabled={loading}
                                className={`
                                    w-full flex justify-center py-3 px-4 border border-gray-300 rounded-lg shadow-sm text-sm font-bold text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#00bfff] 
                                    transition-all duration-200 transform hover:-translate-y-0.5
                                    ${loading ? 'opacity-70 cursor-not-allowed' : ''}
                                `}
                            >
                                {loading ? <LoadingSpinner size="sm" color="gray" /> : 'Entrar com Conta de Serviço'}
                            </button>
                        </div>

                        <p className="text-center text-sm text-gray-500 mt-4">
                            Você será redirecionado para fazer login no DocuWare
                        </p>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default LoginForm;
