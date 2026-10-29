import { data, Form, Link, redirect, useNavigation } from 'react-router';

import { createListener, getListener, type Listener, updateListener } from '../../src/db/listeners';
import { db } from '../lib/db.server';
import {
  LANGUAGES,
  type ListenerFormValues,
  parseListenerForm,
  SOURCE_LABELS,
} from '../lib/listenerSchema';
import type { Route } from './+types/listenerForm';

async function loadListener(id: string): Promise<Listener> {
  const listener = /^\d+$/.test(id) ? await getListener(db, Number(id)) : null;
  if (!listener) throw data('Listener not found', { status: 404 });
  return listener;
}

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `${params.id ? 'Edit' : 'New'} listener · Book Watcher` }];
}

export async function loader({ params }: Route.LoaderArgs) {
  return { listener: params.id ? await loadListener(params.id) : null };
}

export async function action({ params, request }: Route.ActionArgs) {
  const result = parseListenerForm(await request.formData());
  if (!result.ok) {
    return data({ errors: result.errors, values: result.values }, { status: 400 });
  }

  if (params.id) {
    const { id } = await loadListener(params.id);
    await updateListener(db, id, result.input);
  } else {
    await createListener(db, result.input);
  }
  return redirect('/listeners');
}

function toFormValues(listener: Listener | null): ListenerFormValues {
  return {
    name: listener?.name ?? '',
    author: listener?.author ?? '',
    language: listener?.language ?? 'fi',
    format: listener?.format ?? 'ebook',
    minPriceEur: listener?.minPriceEur?.toFixed(2) ?? '',
    maxPriceEur: listener?.maxPriceEur?.toFixed(2) ?? '',
    sources: listener?.sources ?? ['adlibris', 'bokus'],
    enabled: listener?.enabled ?? true,
  };
}

const inputClass =
  'mt-1 block w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300';

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p id={id} className="mt-1 text-sm text-red-600 dark:text-red-400">
      {message}
    </p>
  ) : null;
}

export default function ListenerForm({ loaderData, actionData }: Route.ComponentProps) {
  const { listener } = loaderData;
  const values = actionData?.values ?? toFormValues(listener);
  const errors = actionData?.errors ?? {};
  const saving = useNavigation().state === 'submitting';
  // Re-mount the fields after a failed submit, so they show what was submitted.
  const formKey = actionData ? JSON.stringify(actionData.values) : 'initial';

  const textField = (
    name: 'name' | 'author' | 'minPriceEur' | 'maxPriceEur',
    label: string,
    extra: { hint?: string; inputMode?: 'decimal' } = {},
  ) => (
    <div>
      <label htmlFor={name} className={labelClass}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        defaultValue={values[name]}
        inputMode={extra.inputMode}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `${name}-error` : undefined}
        className={inputClass}
      />
      {extra.hint ? (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{extra.hint}</p>
      ) : null}
      <FieldError id={`${name}-error`} message={errors[name]} />
    </div>
  );

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
        {listener ? `Edit ${listener.name}` : 'New listener'}
      </h1>

      <Form key={formKey} method="post" noValidate className="mt-6 space-y-5">
        {textField('name', 'Name')}
        {textField('author', 'Author', {
          hint: 'Searched for as written, and matched against each book’s author list.',
        })}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="language" className={labelClass}>
              Language
            </label>
            <select
              id="language"
              name="language"
              defaultValue={values.language}
              className={inputClass}
            >
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
            <FieldError id="language-error" message={errors.language} />
          </div>
          <div>
            <label htmlFor="format" className={labelClass}>
              Format
            </label>
            <select id="format" name="format" defaultValue={values.format} className={inputClass}>
              <option value="ebook">E-book</option>
            </select>
            <FieldError id="format-error" message={errors.format} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {textField('minPriceEur', 'Minimum price (€)', { inputMode: 'decimal' })}
          {textField('maxPriceEur', 'Maximum price (€)', { inputMode: 'decimal' })}
        </div>
        <p className="-mt-3 text-xs text-gray-500 dark:text-gray-400">
          Leave a price empty for no limit. Bokus prices are converted from SEK.
        </p>

        <fieldset aria-describedby={errors.sources ? 'sources-error' : undefined}>
          <legend className={labelClass}>Sources</legend>
          <div className="mt-1 flex gap-6">
            {Object.entries(SOURCE_LABELS).map(([source, label]) => (
              <label
                key={source}
                className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100"
              >
                <input
                  type="checkbox"
                  name="sources"
                  value={source}
                  defaultChecked={values.sources.includes(source)}
                />
                {label}
              </label>
            ))}
          </div>
          <FieldError id="sources-error" message={errors.sources} />
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
          <input type="checkbox" name="enabled" defaultChecked={values.enabled} />
          Enabled
        </label>

        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <Link
            to="/listeners"
            className="text-sm text-gray-600 hover:underline dark:text-gray-400"
          >
            Cancel
          </Link>
        </div>
      </Form>
    </main>
  );
}
