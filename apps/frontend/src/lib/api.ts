import axios from 'axios';

// Instância axios — Doc 4 §5.3. Injeta JWT e redireciona para login em 401.
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('azit_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('azit_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
