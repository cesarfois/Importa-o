import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authService } from '../services/authService';

const LoginPage = () => {
    const { user, reloadUser } = useAuth();
    const navigate = useNavigate();
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user) {
            navigate('/compras');
            return;
        }

        const autoLogin = async () => {
            try {
                await authService.loginWithServiceAccount();
                reloadUser();
                navigate('/compras');
            } catch (err) {
                console.error('Auto-login error:', err);
                setError(err.response?.data?.error || err.message || 'Falha ao conectar automaticamente via Conta de Serviço.');
                setLoading(false);
            }
        };

        autoLogin();
    }, [user, navigate, reloadUser]);

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center gap-4">
                <span className="loading loading-spinner loading-lg text-[#4f46e5]"></span>
                <span className="text-sm font-semibold text-slate-600 animate-pulse">Autenticando no DocuWare...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-6 text-center">
                <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md shadow-lg space-y-6">
                    <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">Falha na Autenticação</h2>
                        <p className="text-sm text-slate-500 mt-2">{error}</p>
                    </div>
                    <button
                        onClick={() => window.location.reload()}
                        className="btn bg-[#4f46e5] hover:bg-[#4338ca] text-white w-full border-0 rounded-xl"
                    >
                        Tentar Novamente
                    </button>
                </div>
            </div>
        );
    }

    return null;
};

export default LoginPage;
