using DevExtreme.AspNet.Data;
using DevExtreme.AspNet.Data.Helpers;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using System.Text.Json;

namespace TanStackDemo.Api;

/// <summary>
/// Enables `DataSourceLoadOptions` parameters on controller actions.
/// Adapted from the MIT-licensed sample at
/// https://github.com/DevExpress/DevExtreme.AspNet.Data/blob/master/net/Sample/DataSourceLoadOptions.cs
/// </summary>
[ModelBinder(BinderType = typeof(DataSourceLoadOptionsBinder))]
public class DataSourceLoadOptions : DataSourceLoadOptionsBase {
}

public class DataSourceLoadOptionsBinder : IModelBinder {

    public Task BindModelAsync(ModelBindingContext bindingContext) {
        var loadOptions = new DataSourceLoadOptions();
        try {
            DataSourceLoadOptionsParser.Parse(loadOptions, key => bindingContext.ValueProvider.GetValue(key).FirstOrDefault());
        } catch (Exception ex) when (ex is JsonException
                                         or FormatException
                                         or OverflowException
                                         or ArgumentException
                                         or InvalidOperationException
                                         or NotImplementedException) {
            // Malformed filter/sort/skip/take/requireTotalCount would otherwise throw
            // out of model binding and surface as a bodyless 500. With [ApiController]
            // a ModelState error becomes a 400 ValidationProblemDetails before the
            // action runs, and the action still receives a non-null loadOptions.
            var detail = string.IsNullOrEmpty(ex.Message) ? ex.GetType().Name : ex.Message;
            bindingContext.ModelState.AddModelError(
                bindingContext.ModelName ?? nameof(DataSourceLoadOptions),
                $"Invalid DataSourceLoadOptions: {detail}");
        }
        bindingContext.Result = ModelBindingResult.Success(loadOptions);
        return Task.CompletedTask;
    }

}
