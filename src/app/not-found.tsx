import StoreLink from '@/components/StoreLink';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-4">
      <h2 className="text-4xl font-bold text-gray-900">404 - Dashboard Section Missing</h2>
      <p className="text-gray-600">The page you are looking for has not been implemented or has moved.</p>
      <StoreLink 
        href="/"
        className="px-6 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all"
      >
        Return to Dashboard
      </StoreLink>
    </div>
  );
}
