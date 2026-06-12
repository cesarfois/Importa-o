import Header from './Header';

const DashboardLayout = ({ children }) => {
    return (
        <div className="min-h-screen bg-gray-100 flex">
            {/* Main Content Wrapper */}
            <div className="flex-1 flex flex-col min-h-screen transition-all duration-300 ease-in-out ml-0">
                {/* Header */}
                <Header />

                {/* Content Area */}
                <main className="flex-1 p-6 overflow-x-hidden">
                    <div className="max-w-[1920px] mx-auto animate-fade-in">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
};

export default DashboardLayout;
