package com.example.assetcatalog;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.viewpager2.adapter.FragmentStateAdapter;
import androidx.viewpager2.widget.ViewPager2;

import com.google.android.material.tabs.TabLayout;
import com.google.android.material.tabs.TabLayoutMediator;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends AppCompatActivity {

    private static final String[] TAB_TITLES = {
            "Asset 3D",
            "Asset 2.5D",
            "3D animé"
    };

    static final String TYPE_3D = "3d";
    static final String TYPE_2_5D = "2.5d";
    static final String TYPE_3D_ANIMATED = "3d_animated";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        TabLayout tabLayout = findViewById(R.id.tabLayout);
        ViewPager2 viewPager = findViewById(R.id.viewPager);

        viewPager.setAdapter(new CatalogPagerAdapter(this));
        viewPager.setOffscreenPageLimit(3);

        new TabLayoutMediator(tabLayout, viewPager, (tab, position) ->
                tab.setText(TAB_TITLES[position])).attach();
    }

    static class CatalogPagerAdapter extends FragmentStateAdapter {

        CatalogPagerAdapter(@NonNull AppCompatActivity activity) {
            super(activity);
        }

        @NonNull
        @Override
        public Fragment createFragment(int position) {
            if (position == 0) {
                return AssetListFragment.newInstance(TYPE_3D);
            }
            if (position == 1) {
                return AssetListFragment.newInstance(TYPE_2_5D);
            }
            return AssetListFragment.newInstance(TYPE_3D_ANIMATED);
        }

        @Override
        public int getItemCount() {
            return 3;
        }
    }

    public static class AssetListFragment extends Fragment {

        private static final String ARG_TYPE = "asset_type";

        public AssetListFragment() {
        }

        static AssetListFragment newInstance(String type) {
            AssetListFragment fragment = new AssetListFragment();
            Bundle arguments = new Bundle();
            arguments.putString(ARG_TYPE, type);
            fragment.setArguments(arguments);
            return fragment;
        }

        @Nullable
        @Override
        public View onCreateView(@NonNull LayoutInflater inflater,
                                 @Nullable ViewGroup container,
                                 @Nullable Bundle savedInstanceState) {
            return inflater.inflate(R.layout.fragment_asset_list, container, false);
        }

        @Override
        public void onViewCreated(@NonNull View view,
                                  @Nullable Bundle savedInstanceState) {
            super.onViewCreated(view, savedInstanceState);

            String type = TYPE_3D;
            Bundle arguments = getArguments();
            if (arguments != null) {
                type = arguments.getString(ARG_TYPE, TYPE_3D);
            }

            List<AssetItem> items = AssetRepository.getAssets(type);

            TextView summary = view.findViewById(R.id.textSummary);
            RecyclerView recyclerView = view.findViewById(R.id.recyclerAssets);
            recyclerView.setLayoutManager(new LinearLayoutManager(requireContext()));
            recyclerView.setHasFixedSize(true);
            recyclerView.setAdapter(new AssetAdapter(items));

            if (TYPE_2_5D.equals(type)) {
                summary.setText(getString(R.string.summary_25d, items.size()));
            } else if (TYPE_3D_ANIMATED.equals(type)) {
                summary.setText(getString(R.string.summary_animated, items.size()));
            } else {
                summary.setText(getString(R.string.summary_3d, items.size()));
            }
        }
    }

    static class AssetAdapter extends RecyclerView.Adapter<AssetAdapter.AssetViewHolder> {

        private final List<AssetItem> items;

        AssetAdapter(List<AssetItem> items) {
            this.items = items;
        }

        @NonNull
        @Override
        public AssetViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View view = LayoutInflater.from(parent.getContext())
                    .inflate(R.layout.item_asset, parent, false);
            return new AssetViewHolder(view);
        }

        @Override
        public void onBindViewHolder(@NonNull AssetViewHolder holder, int position) {
            AssetItem item = items.get(position);

            holder.preview.setImageResource(item.previewResource);
            holder.title.setText(item.title);
            holder.category.setText(item.category);
            holder.creator.setText(holder.itemView.getContext().getString(
                    R.string.creator_format,
                    item.creator,
                    item.license));
            holder.description.setText(item.description);

            holder.licenseButton.setOnClickListener(view -> Toast.makeText(
                    view.getContext(),
                    item.title + "\n" + item.license + "\nSource : " + item.creator,
                    Toast.LENGTH_LONG).show());

            holder.openButton.setOnClickListener(view -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(item.sourceUrl));
                    view.getContext().startActivity(intent);
                } catch (ActivityNotFoundException exception) {
                    Toast.makeText(view.getContext(),
                            R.string.no_browser,
                            Toast.LENGTH_SHORT).show();
                }
            });
        }

        @Override
        public int getItemCount() {
            return items.size();
        }

        static class AssetViewHolder extends RecyclerView.ViewHolder {

            final ImageView preview;
            final TextView title;
            final TextView category;
            final TextView creator;
            final TextView description;
            final Button licenseButton;
            final Button openButton;

            AssetViewHolder(@NonNull View itemView) {
                super(itemView);
                preview = itemView.findViewById(R.id.imagePreview);
                title = itemView.findViewById(R.id.textTitle);
                category = itemView.findViewById(R.id.textCategory);
                creator = itemView.findViewById(R.id.textCreator);
                description = itemView.findViewById(R.id.textDescription);
                licenseButton = itemView.findViewById(R.id.buttonLicense);
                openButton = itemView.findViewById(R.id.buttonSource);
            }
        }
    }

    static class AssetItem {

        final String title;
        final String creator;
        final String license;
        final String category;
        final String description;
        final String sourceUrl;
        final int previewResource;

        AssetItem(String title,
                  String creator,
                  String license,
                  String category,
                  String description,
                  String sourceUrl,
                  int previewResource) {
            this.title = title;
            this.creator = creator;
            this.license = license;
            this.category = category;
            this.description = description;
            this.sourceUrl = sourceUrl;
            this.previewResource = previewResource;
        }
    }

    static final class AssetRepository {

        private AssetRepository() {
        }

        static List<AssetItem> getAssets(String type) {
            List<AssetItem> items = new ArrayList<>();

            if (TYPE_3D.equals(type)) {
                items.add(new AssetItem(
                        "Prototype Kit",
                        "Kenney",
                        "Licence CC0",
                        "Asset 3D",
                        "Pack léger pour prototyper rapidement des décors et des niveaux 3D.",
                        "https://kenney.nl/assets/prototype-kit",
                        R.drawable.preview_3d));
                items.add(new AssetItem(
                        "Nature Kit",
                        "Kenney",
                        "Licence CC0",
                        "Asset 3D",
                        "Arbres, rochers, plantes et éléments naturels adaptés aux jeux mobiles.",
                        "https://kenney.nl/assets/nature-kit",
                        R.drawable.preview_3d));
                items.add(new AssetItem(
                        "Medieval Village",
                        "Quaternius",
                        "Licence CC0",
                        "Asset 3D",
                        "Bâtiments et accessoires médiévaux stylisés pour jeu d’aventure ou RPG.",
                        "https://quaternius.com/packs/medievalvillage.html",
                        R.drawable.preview_3d));
            } else if (TYPE_2_5D.equals(type)) {
                items.add(new AssetItem(
                        "Platformer Art Deluxe",
                        "Kenney",
                        "Licence CC0",
                        "Asset 2.5D",
                        "Sprites et décors lisibles pour créer des niveaux de plateforme 2.5D.",
                        "https://kenney.nl/assets/platformer-art-deluxe",
                        R.drawable.preview_25d));
                items.add(new AssetItem(
                        "Isometric City",
                        "Kenney",
                        "Licence CC0",
                        "Asset 2.5D",
                        "Éléments isométriques pour composer une ville avec profondeur visuelle.",
                        "https://kenney.nl/assets/isometric-city",
                        R.drawable.preview_25d));
                items.add(new AssetItem(
                        "Isometric Nature",
                        "Kenney",
                        "Licence CC0",
                        "Asset 2.5D",
                        "Nature isométrique pour jeux de stratégie, gestion ou aventure.",
                        "https://kenney.nl/assets/isometric-nature",
                        R.drawable.preview_25d));
            } else {
                items.add(new AssetItem(
                        "Animated Characters",
                        "Quaternius",
                        "Licence CC0",
                        "3D animé",
                        "Personnages stylisés déjà adaptés à un pipeline d’animation de jeu.",
                        "https://quaternius.com/packs/animatedcharacters.html",
                        R.drawable.preview_anim));
                items.add(new AssetItem(
                        "Low Poly Characters",
                        "Quaternius",
                        "Licence CC0",
                        "3D animé",
                        "Personnages low-poly optimisés pour prototypes et jeux mobiles.",
                        "https://quaternius.com/packs/lowpolycharacters.html",
                        R.drawable.preview_anim));
                items.add(new AssetItem(
                        "Mini Arena",
                        "Kenney",
                        "Licence CC0",
                        "3D animé",
                        "Personnages stylisés utilisables comme base de rig et d’animation.",
                        "https://kenney.nl/assets/mini-arena",
                        R.drawable.preview_anim));
            }

            return items;
        }
    }
}
