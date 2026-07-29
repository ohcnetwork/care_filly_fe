import { Building2, Loader2, Plus, Search } from "lucide-react";
import { navigate } from "raviger";
import { useCallback, useEffect, useState } from "react";

import { FillyQuota, QuotaListResponse, quotaApi } from "@/lib/quota-api";
import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { QuotaSheet } from "@/components/admin/QuotaSheet";

import { useTranslation } from "@/hooks/useTranslation";

const PAGE_SIZE = 10;

export function QuotasPage() {
  const { t } = useTranslation();

  const [data, setData] = useState<QuotaListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [ordering, setOrdering] = useState("-created_date");
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 400);
    return () => clearTimeout(timeout);
  }, [search]);

  const fetchQuotas = useCallback(() => {
    setIsLoading(true);
    quotaApi
      .list({
        facility: debouncedSearch || undefined,
        ordering,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then((response) => {
        setData(response);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : t("failed")),
      )
      .finally(() => setIsLoading(false));
  }, [debouncedSearch, ordering, page, t]);

  useEffect(() => {
    fetchQuotas();
  }, [fetchQuotas]);

  const quotas = data?.results ?? [];
  const pageCount = Math.ceil((data?.count ?? 0) / PAGE_SIZE);

  return (
    <div className="px-4 py-6 md:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          {t("filly_quotas")}
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" />
          {t("new_quota")}
        </button>
      </div>

      <div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 h-3.5 w-3.5 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("search_by_facility_name")}
            className="w-full rounded-md border border-gray-200 bg-white py-2 pr-3 pl-8 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none sm:w-64"
          />
        </div>
        <Select
          value={ordering}
          onValueChange={(value) => {
            setOrdering(value);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="-created_date">{t("newest_first")}</SelectItem>
            <SelectItem value="created_date">{t("oldest_first")}</SelectItem>
            <SelectItem value="-tokens">{t("most_tokens")}</SelectItem>
            <SelectItem value="tokens">{t("least_tokens")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 overflow-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3">{t("facility")}</th>
              <th className="px-4 py-3">{t("monthly_tokens")}</th>
              <th className="px-4 py-3">{t("tokens_per_user")}</th>
              <th className="px-4 py-3">{t("used_tokens")}</th>
              <th className="px-4 py-3">{t("available_tokens")}</th>
              <th className="px-4 py-3">{t("filly")}</th>
            </tr>
          </thead>
          <tbody>
            {quotas.map((quota: FillyQuota) => (
              <tr
                key={quota.external_id}
                onClick={() =>
                  navigate(`/admin/filly/quotas/${quota.external_id}`)
                }
                className="cursor-pointer border-b border-gray-50 transition-colors last:border-0 hover:bg-gray-50"
              >
                <td className="flex items-center gap-2 px-4 py-3 font-medium text-gray-800">
                  <Building2 className="h-3.5 w-3.5 text-gray-400" />
                  {quota.facility_name || quota.facility_external_id}
                </td>
                <td className="px-4 py-3">{quota.tokens.toLocaleString()}</td>
                <td className="px-4 py-3">
                  {quota.tokens_per_user.toLocaleString()}
                </td>
                <td className="px-4 py-3">{quota.used.toLocaleString()}</td>
                <td className="px-4 py-3">
                  {Math.max(quota.tokens - quota.used, 0).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <Badge
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      quota.allow_filly
                        ? "bg-primary-100 text-primary-700"
                        : "bg-gray-100 text-gray-500",
                    )}
                  >
                    {quota.allow_filly ? t("enabled") : t("disabled")}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {isLoading && (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {!isLoading && quotas.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-gray-400">
            {error || t("no_quotas_found")}
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
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={async (quota) => {
          await quotaApi.create(quota);
          fetchQuotas();
        }}
      />
    </div>
  );
}
