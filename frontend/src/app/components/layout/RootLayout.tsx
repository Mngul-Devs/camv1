import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router";
import { useOrganization } from "../../contexts/OrganizationContext";

export function RootLayout() {
  const navigate = useNavigate();
  const { isAuthenticated } = useOrganization();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-[#0c0e12]">
      <Outlet />
    </div>
  );
}
