import {
  Building2,
  CalendarDays,
  CheckCircle2,
  Coins,
  Loader2,
  Pencil,
  Search,
  User,
  Users,
} from "lucide-react";
import { navigate } from "raviger";
import { useCallback, useEffect, useState } from "react";

import { QuotaListResponse, ScribeQuota, quotaApi } from "@/lib/quota-api";

import { Badge } from "@/components/ui/badge";

import { QuotaSheet } from "@/components/admin/QuotaSheet";

import { useTranslation } from "@/hooks/useTranslation";

const PAGE_SIZE = 10;

export function QuotaUsagePage({ quotaId }: { quotaId: string }) {
  const { t } = useTranslation();

  const [quota, setQuota] = useState<ScribeQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);

  const [userQuotas, setUserQuotas] = useState<QuotaListResponse | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);

  const fetchQuota = useCallback(() => {
    setQuotaLoading(true);
    quotaApi
      .get(quotaId)
      .then((response) => {
        setQuota(response);
        setQuotaError(null);
      })
      .catch((err: unknown) =>
        setQuotaError(err instanceof Error ? err.message : t("failed")),
      )
      .finally(() => setQuotaLoading(false));
  }, [quotaId, t]);

  useEffect(() => {
    fetchQuota();
  }, [fetchQuota]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 400);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (!quota) return;
    setUsersLoading(true);
    quotaApi
      .list({
        facility_id: quota.facility_external_id,
        username: debouncedSearch || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then(setUserQuotas)
      .finally(() => setUsersLoading(false));
  }, [quota, debouncedSearch, page]);

  if (quotaLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!quota) {
    return (
      <p className="px-4 py-10 text-center text-sm text-gray-400">
        {quotaError || t("no_quotas_found")}
      </p>
    );
  }

  const overview = [
    {
      icon: <Building2 className="h-4 w-4" />,
      label: t("facility"),
      value: quota.facility_name || quota.facility_external_id,
    },
    {
      icon: <Coins className="h-4 w-4" />,
      label: t("monthly_tokens"),
      value: quota.tokens.toLocaleString(),
    },
    {
      icon: <User className="h-4 w-4" />,
      label: t("tokens_per_user"),
      value: quota.tokens_per_user.toLocaleString(),
    },
    {
      icon: <Coins className="h-4 w-4" />,
      label: t("used_tokens"),
      value: quota.used.toLocaleString(),
    },
    {
      icon: <CheckCircle2 className="h-4 w-4" />,
      label: t("available_tokens"),
      value: Math.max(quota.tokens - quota.used, 0).toLocaleString(),
    },
    {
      icon: <CalendarDays className="h-4 w-4" />,
      label: t("created_at"),
      value: quota.created_date
        ? new Date(quota.created_date).toLocaleDateString()
        : "—",
    },
  ];

  const users = userQuotas?.results ?? [];
  const pageCount = Math.ceil((userQuotas?.count ?? 0) / PAGE_SIZE);

  return (
    <div className="px-4 py-6 md:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          {t("quota_details")}
        </h1>
        <button
          onClick={() => setShowEdit(true)}
          className="flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
        >
          <Pencil className="h-3.5 w-3.5" />
          {t("edit_quota")}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        {overview.map((item, index) => (
          <div key={index} className="flex flex-col">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              {item.icon}
              {item.label}
            </div>
            <div className="mt-1 text-sm font-medium text-gray-800">
              {item.value}
            </div>
          </div>
        ))}
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <CheckCircle2 className="h-4 w-4" />
            {t("scribe")}
          </div>
          <div className="mt-1">
            <Badge variant={quota.allow_scribe ? "primary" : "secondary"}>
              {quota.allow_scribe ? t("enabled") : t("disabled")}
            </Badge>
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800">
          <Users className="h-4 w-4" />
          {t("user_quotas")}
        </h2>
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 h-3.5 w-3.5 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("search_by_username")}
            className="w-full rounded-md border border-gray-200 bg-white py-2 pr-3 pl-8 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none sm:w-64"
          />
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3">{t("user")}</th>
              <th className="px-4 py-3">{t("used_tokens")}</th>
              <th className="px-4 py-3">{t("available_tokens")}</th>
              <th className="px-4 py-3">{t("started_using_since")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((userQuota) => (
              <tr
                key={userQuota.external_id}
                className="border-b border-gray-50 last:border-0"
              >
                <td className="flex items-center gap-2 px-4 py-3 font-medium text-gray-800">
                  <User className="h-3.5 w-3.5 text-gray-400" />
                  {userQuota.user?.username}
                </td>
                <td className="px-4 py-3">{userQuota.used.toLocaleString()}</td>
                <td className="px-4 py-3">
                  {Math.max(
                    userQuota.tokens - userQuota.used,
                    0,
                  ).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  {userQuota.tnc_accepted_date
                    ? new Date(userQuota.tnc_accepted_date).toLocaleDateString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {usersLoading && (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {!usersLoading && users.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-gray-400">
            {t("no_user_quotas_yet")}
          </p>
        )}
      </div>

      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 transition-colors hover:bg-gray-50 disabled:opacity-40"
          >
            {t("previous")}
          </button>
          <span className="text-xs text-gray-500">
            {t("page_of", { page: page + 1, total: pageCount })}
          </span>
          <button
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 transition-colors hover:bg-gray-50 disabled:opacity-40"
          >
            {t("next")}
          </button>
        </div>
      )}

      <QuotaSheet
        open={showEdit}
        quota={quota}
        onClose={() => setShowEdit(false)}
        onSubmit={async (updated) => {
          await quotaApi.update(quota.external_id, {
            tokens: updated.tokens,
            tokens_per_user: updated.tokens_per_user,
            allow_scribe: updated.allow_scribe,
          });
          fetchQuota();
        }}
        onDelete={async () => {
          await quotaApi.delete(quota.external_id);
          navigate("/admin/filly/quotas");
        }}
      />
    </div>
  );
}
