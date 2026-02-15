# maheshbabugorantla.github.io

Personal tech blog by Mahesh Babu Gorantla — writing about Python, Django, Kubernetes, and backend development.

**Live site:** <https://maheshbabugorantla.github.io/>

## Tech Stack

- **Static site generator:** [Hugo](https://gohugo.io/)
- **Theme:** [PaperMod](https://github.com/adityatelange/hugo-PaperMod)
- **Search:** [Pagefind](https://pagefind.app/)
- **Hosting:** GitHub Pages via GitHub Actions

## Local Development

```bash
# Clone the repo (with submodules for the theme)
git clone --recurse-submodules https://github.com/maheshbabugorantla/maheshbabugorantla.github.io.git
cd maheshbabugorantla.github.io

# Start the dev server
hugo server -D
```

Hugo v0.147+ is required. Install it from [gohugo.io/installation](https://gohugo.io/installation/).

## Project Structure

```
.
├── content/
│   ├── posts/          # Blog posts
│   └── about.md        # About page
├── layouts/            # Custom layout overrides
├── assets/             # Custom CSS
├── static/             # Static files
├── themes/PaperMod/    # Theme (git submodule)
├── hugo.toml           # Site configuration
└── .github/workflows/  # CI/CD (Hugo build + Pagefind + deploy)
```

## License

All blog content is copyright Mahesh Babu Gorantla. The site source code is available under the [MIT License](LICENSE).
