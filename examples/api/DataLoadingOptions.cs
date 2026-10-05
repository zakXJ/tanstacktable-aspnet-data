using System.Collections;
using DevExtreme.AspNet.Data;

namespace TanStackDemo.Api;

public sealed class DataLoadingOptions {
    public int? MaxTake { get; set; }
    public int? MaxFilterNodes { get; set; }
    public int? MaxSorts { get; set; }
    public string[]? AllowedSelectors { get; set; }
}

public static class DataLoadingValidator {
    private static readonly HashSet<string> FilterOperators = new(StringComparer.OrdinalIgnoreCase) {
        "=", "<>", ">", ">=", "<", "<=", "contains", "notcontains", "startswith", "endswith",
    };

    public static string? ValidateAndApply(
        DataSourceLoadOptions loadOptions,
        DataLoadingOptions limits,
        IReadOnlySet<string> defaultSelectors) {
        var allowed = limits.AllowedSelectors is { Length: > 0 }
            ? new HashSet<string>(limits.AllowedSelectors, StringComparer.OrdinalIgnoreCase)
            : defaultSelectors;

        if (limits.MaxTake is int maxTake && maxTake > 0 && (loadOptions.Take <= 0 || loadOptions.Take > maxTake)) {
            loadOptions.Take = maxTake;
        }

        if (limits.MaxSorts is int maxSorts && maxSorts > 0 && (loadOptions.Sort?.Length ?? 0) > maxSorts) {
            return $"At most {maxSorts} sort expressions are allowed.";
        }
        foreach (var sort in loadOptions.Sort ?? []) {
            if (!allowed.Contains(sort.Selector)) return $"Selector '{sort.Selector}' is not allowed.";
        }

        var filterNodes = 0;
        var filterError = ValidateFilter(loadOptions.Filter, allowed, ref filterNodes, limits.MaxFilterNodes);
        if (filterError is not null) return filterError;

        if ((loadOptions.Group?.Length ?? 0) > 0 || (loadOptions.TotalSummary?.Length ?? 0) > 0 ||
            (loadOptions.GroupSummary?.Length ?? 0) > 0 || (loadOptions.Select?.Length ?? 0) > 0) {
            return "Grouping, summaries and remote projections are not enabled for this endpoint.";
        }
        return null;
    }

    private static string? ValidateFilter(
        IList? filter,
        IReadOnlySet<string> allowed,
        ref int nodes,
        int? maxNodes) {
        if (filter is null) return null;
        if (filter.Count >= 2 && filter[0] is string selector && filter[1] is string operation &&
            FilterOperators.Contains(operation)) {
            nodes++;
            if (maxNodes is > 0 && nodes > maxNodes) return $"At most {maxNodes} filter expressions are allowed.";
            if (!allowed.Contains(selector)) return $"Selector '{selector}' is not allowed.";
            return null;
        }
        foreach (var item in filter) {
            if (item is IList nested) {
                var error = ValidateFilter(nested, allowed, ref nodes, maxNodes);
                if (error is not null) return error;
            }
        }
        return null;
    }
}
