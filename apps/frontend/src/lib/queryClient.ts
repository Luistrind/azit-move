import { QueryClient } from '@tanstack/react-query';

// Cliente TanStack Query — Doc 4 §5.1. Cache e estados de carregamento centralizados.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});
