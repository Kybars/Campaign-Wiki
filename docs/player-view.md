# Player View read model

Campaign pages accept a `view=player` query parameter. Its absence is the default DM View. The typed `CampaignViewMode` enters at the server-side query boundary, where entity, fact, relationship, evidence, search, category, count, and location-hierarchy reads are filtered before their page components render.

Player View fails closed: hidden entities are omitted; a visible relationship with a hidden endpoint is omitted; facts mentioning a hidden entity are omitted; missing player summaries and overviews do not use GM fallbacks; and legacy entity-level source excerpts are omitted because they are not fact-specific. Fact evidence remains available only for facts which survive filtering.

For locations, filtering happens before hierarchy construction. A visible descendant behind a hidden ancestor becomes an unparented root. This preserves accessibility without exposing the ancestor or inventing a containment edge. Breadcrumbs stop at that boundary.

This is a GM preview/read filter, not authentication or secure campaign sharing. v0.3 has no accounts or permissions. Player-mode responses are nevertheless deliberately spoiler-safe.
