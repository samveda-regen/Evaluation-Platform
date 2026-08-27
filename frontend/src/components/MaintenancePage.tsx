interface MaintenancePageProps {
  message?: string;
}

export default function MaintenancePage({ message }: MaintenancePageProps) {
  return (
    <div className="fixed inset-0 z-[9999] flex min-h-screen w-full flex-col items-center justify-center gap-6 bg-white px-6 text-center">
      <img
        src="/maintenance-icon.png"
        alt=""
        className="h-20 w-20 animate-[spin_3s_linear_infinite]"
      />
      <div className="max-w-md">
        <h1 className="text-2xl font-bold text-gray-900">Under Maintenance</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-gray-600">
          {message || 'The platform is temporarily down for maintenance. Please try again shortly.'}
        </p>
        <p className="mt-2 text-[13px] text-gray-400">If this persists, please contact support.</p>
      </div>
    </div>
  );
}
