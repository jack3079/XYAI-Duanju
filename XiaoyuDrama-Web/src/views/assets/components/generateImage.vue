<template>
  <div class="generateImage">
    <t-dialog
      v-model:visible="generateImageShow"
      top="4vh"
      width="80vw"
      :header="$t('workbench.assets.gen.header')"
      :maskClosable="false"
      :footer="false"
      @close-btn-click="handleCancel">
      <div class="data f">
        <t-card :bordered="false" :style="{ width: '40%' }">
          <div class="uploadReferenceImage">
            <div class="jb">
              <span style="font-size: 16px; font-weight: 900">{{ $t("workbench.assets.gen.uploadRef") }}</span>
              <t-tag>{{ $t("workbench.assets.gen.optional") }}</t-tag>
            </div>
            <div class="upload">
              <t-upload
                v-model="referenceFileList"
                :autoUpload="autoUpload"
                :disabled="generateLoading"
                theme="image"
                :abridgeName="[10, 8]"
                draggable
                action=""
                accept="image/*"
                :showImageFileName="showImageFileName" />
            </div>
          </div>
          <div class="rawPicturePrompt">
            <div class="jb">
              <span style="font-size: 16px; font-weight: 900">{{ $t("workbench.assets.gen.promptLabel") }}</span>
              <div class="ac" style="cursor: pointer" @click.stop="generatePrompt">
                <i-magic theme="outline" size="18" />
                <span style="margin-left: 5px; font-size: 13px">{{ $t("workbench.assets.gen.smartGenerate") }}</span>
              </div>
            </div>
            <div class="input">
              <t-loading :loading="promptLoading" :text="$t('workbench.assets.gen.generatingPrompt')">
                <t-textarea
                  v-model="props.formData.prompt"
                  :placeholder="$t('workbench.assets.gen.promptPlaceholder')"
                  :autosize="{ minRows: 15, maxRows: 15 }"
                  :disabled="generateLoading" />
              </t-loading>
            </div>
          </div>
          <div class="selectModel f">
            <div style="width: 60%">
              <span style="font-size: 16px; font-weight: 900">{{ $t("workbench.assets.gen.selectModel") }}</span>
              <modelSelect v-model="selectValue" :type="`image`" />
            </div>
            <div style="width: 40%; margin-left: 15px">
              <span style="font-size: 16px; font-weight: 900">{{ $t("workbench.assets.gen.selectResolution") }}</span>
              <t-select v-model="resolution">
                <t-option key="1K" label="1K" value="1K" />
                <t-option key="2K" label="2K" value="2K" />
                <t-option key="4K" label="4K" value="4K" />
              </t-select>
            </div>
          </div>
          <div class="generateButton" style="margin-top: 20px">
            <t-button theme="primary" size="large" block :loading="generateLoading" @click="handleGenerate">
              {{ $t("workbench.assets.gen.generateBtn") }}
            </t-button>
          </div>
        </t-card>
        <t-divider layout="vertical" style="height: 700px" />
        <t-card :title="$t('workbench.assets.gen.resultTitle')" :bordered="false" :style="{ width: '60%' }">
          <template #actions>
            <t-tag v-if="resultImages.length">{{ $t("workbench.assets.gen.generatedCount", { count: resultImages.length }) }}</t-tag>
          </template>
          <div class="resultImages" style="gap: 20px; flex-wrap: wrap">
            <div class="image f w">
              <div
                v-for="(img, index) in resultImages"
                :key="index"
                class="resultImage"
                :class="{ 'is-selected': selectedImageIndex === index, 'is-disabled': img.state !== 'å·²å®Œæˆ' }"
                @click="img.state === 'å·²å®Œæˆ' ? selectImage(index) : null"
                @mouseenter="hoveredImageIndex = index"
                @mouseleave="hoveredImageIndex = null">
                <div v-if="img.state === 'ç”Ÿæˆä¸­'" class="generating-overlay f ac jc">
                  <t-loading :text="$t('workbench.assets.gen.generatingLabel')" />
                </div>
                <div v-else-if="img.state === 'ç”Ÿæˆå¤±è´¥' && !img.src" class="failed-overlay f ac jc">
                  <div style="text-align: center">
                    <i-close-one theme="filled" size="40" fill="#d0021b" />
                    <div style="margin-top: 10px; color: #d0021b; font-weight: bold">{{ $t("workbench.assets.gen.genFailed") }}</div>
                  </div>
                </div>
                <t-image v-else :src="img.src" fit="cover" :style="{ width: '100%', height: '100%', borderRadius: '20px' }">
                  <template #loading>
                    <t-loading />
                  </template>
                </t-image>
                <div class="preview" v-show="hoveredImageIndex === index && img.state === 'å·²å®Œæˆ'">
                  <i-preview-open theme="outline" size="25" fill="#ffffff" @click.stop="handlePreview(img.src)" />
                </div>
                <div class="selected" v-show="selectedImageIndex === index && img.state === 'å·²å®Œæˆ'">
                  <i-check-one theme="filled" size="25" fill="#000" />
                </div>
                <div class="delImage" v-show="hoveredImageIndex === index">
                  <i-delete theme="outline" size="20" fill="#d0021b" @click.stop="deleteImage(img.id, index)" />
                </div>
              </div>
              <div class="customUpload">
                <t-upload
                  ref="customUploadRef"
                  action=""
                  v-model="customFileList"
                  :disabled="generateLoading"
                  :autoUpload="false"
                  theme="custom"
                  accept="image/*"
                  :max="1"
                  @change="handleCustomUpload"
                  :showImageFileName="false">
                  <div
                    class="uploadPlaceholder f ac jc"
                    style="width: 180px; height: 180px; border: 2px dashed #d9d9d9; border-radius: 20px; cursor: pointer">
                    <i-plus theme="outline" size="24" fill="#4a4a4a" />
                  </div>
                </t-upload>
              </div>
            </div>
          </div>
          <div class="keep">
            <t-button theme="primary" size="large" block :disabled="selectedImageIndex === null" @click="onClick">
              {{ $t("workbench.assets.gen.confirmSelect") }}
            </t-button>
          </div>
        </t-card>
      </div>
      <t-image-viewer v-model="visible" :images="[trigger]" />
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import modelSelect from "@/components/modelSelect.vue";
import projectStore from "@/stores/project";
const { project } = storeToRefs(projectStore());
import axios from "@/utils/axios";
const props = defineProps<{
  formData: {
    id?: number;
    name?: string;
    describe?: string;
    type?: string;
    prompt?: string;
    src: string;
  };
}>();

//æ˜¾ç¤ºç”Ÿæˆå›¾ç‰‡çš„å¼¹çª—
const generateImageShow = defineModel({
  type: Boolean,
  default: false,
});

//å…³é—­ç”Ÿæˆå›¾ç‰‡çš„å¼¹çª—
function handleCancel() {
  generateImageShow.value = false;
  generateLoading.value = false;
  stopPolling();
  emit("update");
}
//ä¸Šä¼ å‚è€ƒå›¾ç‰‡
const referenceFileList = ref<any[]>([]);
const autoUpload = ref(false);
const showImageFileName = ref(false);
const generateLoading = ref(false);

// éžå¯ç¼–çš„æµ·å¤–å½¹ä½“å…ƒæ‰¨æ²¢è§£çš„æ”¿ç­–å…³ç³»

const selectValue = ref<string>("");
const resolution = ref<"1K" | "2K" | "4K">("2K");

// é›†ä¸­ä½œå‰è¡OšâžB¾ò3–6–"¦7¢š)½¹ÍÐÁÉ½µÁÑ1½…‘¥¹œ€ôÉ•˜¡™…±Í”¤ì()…Íå¹Œ™Õ¹Ñ¥½¸•¹•É…Ñ•AÉ½µÁÐ ¤ì(€¥˜€ …ÁÉ½©•Ð¹Ù…±Õ”ü¹¥ñð€…ÁÉ½ÁÌ¹™½Éµ…Ñ„¹¥¤É•ÑÕÉ¸ì(€ÁÉ½µÁÑ1½…‘¥¹œ¹Ù…±Õ”€ôÑÉÕ”ì(€ÑÉäì(€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð…á¥½Ì¹Á½ÍÐ ˆ½…ÍÍ•ÑÍ•¹•É…Ñ”½Á½±¥Í¡ÍÍ•ÑÍAÉ½µÁÐˆ°ì(€€€€€…ÍÍ•ÑÍ%èÁÉ½ÁÌ¹™½Éµ…Ñ„¹¥°(€€€€€ÁÉ½©•Ñ%èÁÉ½©•Ð¹Ù…±Õ”¹¥°(€€€€€ÑåÁ”èÁÉ½ÁÌ¹™½Éµ…Ñ„¹ÑåÁ”€ôôô€‰ÁÉ½ÁÌˆ€ü€‰Ñ½½°ˆ€èÁÉ½ÁÌ¹™½Éµ…Ñ„¹ÑåÁ”°(€€€€€¹…µ”èÁÉ½ÁÌ¹™½Éµ…Ñ„¹¹…µ”€üü€ˆˆ°(€€€€€‘•ÍÉ¥‰”èÁÉ½ÁÌ¹™½Éµ…Ñ„¹‘•ÍÉ¥‰”€üü€ˆˆ°(€€€ô¤ì(€€€½¹ÍÐÁÉ½µÁÐ€ôÉ•ÍÁ½¹Í”¹‘…Ñ„ü¹‘…Ñ„ü¹ÁÉ½µÁÐì(€€€¥˜€¡ÁÉ½µÁÐ¤ì(€€€€€ÁÉ½ÁÌ¹™½Éµ…Ñ„¹ÁÉ½µÁÐ€ôÁÉ½µÁÐì(€€€€€Ý¥¹‘½Ü¸‘µ•ÍÍ…”¹ÍÕ•ÍÌ ‘Ð ‰Ý½É­‰•¹ ¹…ÍÍ•ÑÌ¹•¸¹ÁÉ½µÁÑ•¹MÕ•ÍÌˆ¤¤ì(€€€ô(€ô…Ñ €¡”¤ì(€€€½¹Í½±”¹•ÉÉ½È¡”¤ì(€€€Ý¥¹‘½Ü¸‘µ•ÍÍ…”¹•ÉÉ½È ‘Ð ‰Ý½É­‰•¹ ¹…ÍÍ•ÑÌ¹•¸¹ÁÉ½µÁÑ•¹…¥°ˆ¤¤ì(€ô™¥¹…±±äì(€€€ÁÉ½µÁÑ1½…‘¥¹œ¹Ù…±Õ”€ô™…±Í”ì(€ô)ô((¼¼ƒžRš"C–nûž&)™Õ¹Ñ¥½¸¡…¹‘±••¹•É…Ñ” ¤ì(€¥˜€ …ÁÉ½ÁÌ¹™½Éµ…Ñ„¹ÁÉ½µÁÐ¤ì(€€€Ý¥¹‘½Ü¸‘µ•ÍÍ…”¹•ÉÉ½È ‘Ð ‰Ý½É­‰•¹ ¹…ÍÍ•ÑÌ¹•¸¹™¥±±AÉ½µÁÐˆ¤¤ì(€€€É•ÑÕÉ¸ì(€ô(€¥˜€ …É•Í½±ÕÑ¥½¸¹Ù…±Õ”¤ì(€€€Ý¥¹‘½Ü¸‘µ•ÍÍ…”¹•ÉÉ½È ‘Ð ‰Ý½É­‰•¹ ¹…ÍÍ•ÑÌ¹•¸¹Á¥­I•Í½±ÕÑ¥½¸ˆ¤¤ì(€€€É•ÑÕÉ¸ì(€ô(€¥˜€ …Í•±•ÑY…±Õ”¹Ù…±Õ”¤ì(€€€Ý¥¹‘½Ü¸‘µ•ÍÍ…”¹•ÉÉ½È ‘Ð ‰Ý½É­‰•¹ ¹…ÍÍ•ÑÌ¹•¸¹Á¥­5½‘•°ˆ¤¤ì(€€€É•ÑÕÉ¸ì(€ô(€•¹•É…Ñ•1½…‘¥¹œ¹Ù…±Õ”€ôÑÉÕ”ì(€ÑÉäì(€€€±•ÐÉ•™•É•¹•%µ…•	…Í”ØÐ€ô€ˆˆì(€€€¥˜€¡É•™•É•¹•¥±•1¥ÍÐ¹Ù…±Õ”¹±•¹Ñ €ø€À¤ì(€€€€€½¹ÍÐ™¥±”€ôÉ•™•É•¹•¥±•1¥ÍÐ¹Ù…±Õ•lÁt¹É…Üì(€€€€€¥˜€¡™¥±”¥¹ÍÑ…¹•½˜¥±”¤ì(€€€€€€€É•™•É•¹•%µ…•	…Í”ØÐ€ô…Ý…¥Ð¹•ÜAÉ½µ¥Í”ñÍÑÉ¥¹œø ¡É•Í½±Ù”¤€ôøì(€€€€€€€€€½¹ÍÐÉ•…‘•È€ô¹•Ü¥±•I•…‘•È ¤ì(€€€€€€€€€É•…‘•È¹½¹±½…€ô€¡”¤€ôøì(€€€€€€€€€€€½¹ÍÐ‰…Í”ØÐ€ô”¹Ñ…É•Ðü¹É•ÍÕ±Ð…ÌÍÑÉ¥¹œì(€€€€€€€€€€€É•Í½±Ù”¡‰…Í”ØÐ¤ì(€€€€€€€€€ôì(€€€€€€€€€É•…‘•È¹É•…‘Í…Ñ…UI0¡}™¥±”¤ì(€€€€€€€ô¤ì(€€€€€ô(€€€ô(€€€…Ý…¥Ð…á¥½Ì¹Á½ÍÐ ˆ½…ÍÍ•ÑÍ•¹•É…Ñ”½•¹•É…Ñ•ÍÍ•ÑÌˆ°ì(€€€€€ÑåÁ”èÁÉ½ÁÌ¹™½Éµ…Ñ„¹ÑåÁ”€üü€‰ÁÉ½ÁÌˆ°(€€€€€ÁÉ½©•Ñ%èÁÉ½©•Ð¹Ù…±Õ”ü¹¥°(€€€€€¹…µ”èÁÉ½ÁÌ¹™½Éµ…Ñ„¹¹…µ”€üü€‘Ð ‰Ý½É­‰•¹ ¹…ÍÍ•ÑÌ¹•¸¹Õ¹¹…µ•ˆ¤°(€€€€€‰…Í”ØÐèÉ•™•É•¹•%µ…•	…Í”ØÐ°(€€€€€ÁÉ½µÁÐèÁÉ½ÁÌ¹™½Éµ…Ñ„¹ÁÉ½µÁÐ°(€€€€€µ½‘•°èÍ•±•ÑY…±Õ”¹Ù…±Õ”°(€€€€€¥èÁÉ½ÁÌ¹™½Éµ…Ñ„¹¥°(€€€€€É•Í½±ÕÑ¥½¸èÉ•Í½±ÕÑ¥½¸¹Ù…±Õ”°(€€€ô¤ì(€€€Ý¥¹‘½Ü¸‘µ•ÍÍ…”¹ÍÕ•ÍÌ ‘Ð ‰Ý½É­‰•¹ ¹…ÍÍ•ÑÌ¹•¸¹…ÍÍ•Ñ•¹MÕ•ÍÌˆ¤¤ì(€€€…Ý…¥Ð™•Ñ¡•¹•É…Ñ•‘%µ…•Ì ¤ì(€ô…Ñ €¡”è…¹ä¤ì(€€€Ý¥¹‘½Ü¸‘µ•ÍÍ…”¹•ÉÉ½È¡”¹µ•ÍÍ…”€üü€‘Ð ‰Ý½É­‰•¹ ¹…ÍÍ•ÑÌ¹•¸¹…ÍÍ•Ñ•¹…¥°ˆ¤¤ì(€€€™•Ñ¡•¹•É…Ñ•‘%µ…•Ì ¤ì(€ô™¥¹…±±äì(€€€•¹•É…Ñ•1½…‘¥¹œ¹Ù…±Õ”€ô™…±Í”ì(€ô)ô(¼¿¢«–ºk’æ'’â+’òƒ–nûž&)½¹ÍÐÕÍÑ½µ¥±•1¥ÍÐ€ôÉ•˜ñ…¹åmtø¡mt¤ì(¼¼ƒ–’žB¢«–ºk’æ'’â+’ò€)™Õ¹Ñ¥½¸¡…¹‘±•ÕÍÑ½µUÁ±½…¡™¥±•Ìè…¹åmt¤èÙ½¥ì(€¥˜€¡™¥±•Ì¹±•¹Ñ €ø€À¤ì(€€€½¹ÍÐ™¥±”€ô™¥±•ÍlÁtü¹É…Üñð™¥±•ÍlÁtì(€€€¥˜€¡™¥±”¥¹ÍÑ…¹•½˜¥±”¤ì(€€€€€½¹ÍÐÉ•…‘•È€ô¹•Ü¥±•I•…‘•È ¤ì(€€€€€É•…‘•È¹½¹±½…€ô€¡”¤€ôøì(€€€€€€€½¹ÍÐ‰…Í”ØÐ€ô”¹Ñ…É•Ðü¹É•ÍÕ±Ð…ÌÍÑÉ¥¹œì(€€€€€€€É•ÍÕ±Ñ%µ…•Ì¹Ù…±Õ”¹ÁÕÍ ¡ì(€€€€€€€€€¥è€ˆˆ°(€€€€€€€€€ÍÉŒè‰…Í”ØÐ°(€€€€€€€€€ÍÑ…Ñ”è€‹–ÞË–º3š"@ˆ°(€€€€€€€ô¤ì(€€€€€€€Ý¥¹‘½Ü¸‘µ•ÍÍ…”¹ÍÕ•ÍÌ ‘Ð ‰Ý½É­‰•¹ ¹…ÍÍ•ÑÌ¹•¸¹ÕÁ±½…‘=¬ˆ¤¤ì(€€€€€€€ÕÍÑ½µ¥±•1¥ÍÐ¹Ù…±Õ”€ômtì(€€€€€ôì(€€€€€É•…‘•È¹É•…‘Í…Ñ…UI0¡™¥±”¤ì(€€€ô(€ô)ô((¼¿žRš"CžîOšzp)½¹ÍÐÉ•ÍÕ±Ñ%µ…•Ì€ôÉ•˜ñì¥èÍÑÉ¥¹œìÍÉŒèÍÑÉ¥¹œìÍÑ…Ñ”èÍÑÉ¥¹œìÍ•±•Ñ•üè‰½½±•…¸õmtø¡mt¤ì(¼¿¦Š¢ž#–nûž&)½¹ÍÐÙ¥Í¥‰±”€ôÉ•˜¡™…±Í”¤ì)½¹ÍÐÑÉ¥•È€ôÉ•˜ ¤ì)™Õ¹Ñ¥½¸¡…¹‘±•AÉ•Ù¥•Ü¡ÍÉŒèÍÑÉ¥¹œ¤ì(€Ù¥Í¥‰±”¹Ù…±Õ”€ôÑÉÕ”ì(€ÑÉ¥•È¹Ù…±Õ”€ôÍÉŒì)ô(¼¿¦'š.§žRš"Cžj–nûž&)½¹ÍÐÍ•±•Ñ•‘%µ…•%¹‘•à€ôÉ•˜ñ¹Õµ‰•Èð¹Õ±°ø¡¹Õ±°¤ì)½¹ÍÐ¡½Ù•É•‘%µ…•%¹‘•à€ôÉ•˜ñ¹Õµ‰•Èð¹Õ±°ø¡¹Õ±°¤ì()Ý…Ñ  (€€ ¤€ôø•¹•É…Ñ•%µ…•M¡½Ü¹Ù…±Õ”°(€€¡¹•ÝY…°¤€ôøì(€€€¥˜€¡¹•ÝY…°¤ì(€€€€€É•™•É•¹•¥±•1¥ÍÐ¹Ù…±Õ”€ômtì(€€€€€Ù…±Õ”È¹Ù…±Õ”€ô€ˆˆì(€€€€€Í•±•Ñ•‘%µ…•%¹‘•à¹Ù…±Õ”€ô¹Õ±°ì(€€€€€¡½Ù•É•‘%µ…•%¹‘•à¹Ù…±Õ”€ô¹Õ±°ì(€€€€€•¹•É…Ñ•1½…‘¥¹œ¹Ù…±Õ”€ô™…±Í”ì(€€€€€™•Ñ¡•¹•É…Ñ•‘%µ…•Ì ¤ì(€€€ô(€ô°(¤ì(¼¼ƒ¢:ß–>[–nûž&–"_¢† )±•ÐÁ½±±¥¹Q¥µ•ÈèI•ÑÕÉ¹QåÁ”ñÑåÁ•½˜Í•ÑQ¥µ•½ÕÐøð¹Õ±°€ô¹Õ±°ì()™Õ¹Ñ¥½¸ÍÑ½ÁA½±±¥¹œ ¤ì(€¥˜€¡Á½±±¥¹Q¥µ•È¤ì(€€€±•…ÉQ¥µ•½ÕÐ¡Á½±±¥¹Q¥µ•È¤ì(€€€Á½±±¥¹Q¥µ•È€ô¹Õ±°ì(€ô)ô()…Íå¹Œ™Õ¹Ñ¥½¸™•Ñ¡•¹•É…Ñ•‘%µ…•Ì ¤ì(€½¹ÍÐì‘…Ñ„ô€ô…Ý…¥Ð…á¥½Ì¹Á½ÍÐ ˆ½…ÍÍ•ÑÌ½•Ñ%µ…”ˆ°ì…ÍÍ•ÑÍ%èÁÉ½ÁÌ¹™½Éµ…Ñ„¹¥ô¤ì(€½¹ÍÐ¥µ…•Ì€ô‘…Ñ„¹Ñ•µÁÍÍ•ÑÌ¹µ…À ¡¥Ñ•´èì¥èÍÑÉ¥¹œì™¥±•A…Ñ èÍÑÉ¥¹œìÍÑ…Ñ”èÍÑÉ¥¹œìÍ•±•Ñ•üè‰½½±•…¸ô¤€ôø€¡ì(€€€¥è¥Ñ•´¹¥°(€€€ÍÉŒè¥Ñ•´¹™¥±•A…Ñ °(€€€ÍÑ…Ñ”è¥Ñ•´¹ÍÑ…Ñ”°(€€€Í•±•Ñ•è¥Ñ•´¹Í•±•Ñ•€üü™…±Í”°(€ô¤¤ì(€É•ÍÕ±Ñ%µ…•Ì¹Ù…±Õ”€ô¥µ…•Ìì(€½¹ÍÐÍ•±•Ñ•‘%‘à€ô¥µ…•Ì¹™¥¹‘%¹‘•à ¡¥µœèìÍ•±•Ñ•üè‰½½±•…¸ô¤€ôø¥µœ¹Í•±•Ñ•¤ì(€¥˜€¡Í•±•Ñ•‘%‘à€„ôô€´Ä¤ì(€€€Í•±•Ñ•‘%µ…•%¹‘•à¹Ù…±Õ”€ôÍ•±•Ñ•‘%‘àì(€ô((€€¼¼ƒ–ššzs¢þcšr$‹žRš"C’â´‹žj–nûž&¾ò3¢«–*£¢ö»¢¾‹–"ßšZÀ(€½¹ÍÐ¡…Í•¹•É…Ñ¥¹œ€ô¥µ…•Ì¹Í½µ” ¡¥µœèìÍÑ…Ñ”èÍÑÉ¥¹œô¤€ôø¥µœ¹ÍÑ…Ñ”€ôôô€‹žRš"C’â´ˆ¤ì(€ÍÑ½ÁA½±±¥¹œ ¤ì(€¥˜€¡¡…Í•¹•É…Ñ¥¹œ€˜˜•¹•É…Ñ•%µ…•M¡½Ü¹Ù…±Õ”¤ì(€€€Á½±±¥¹Q¥µ•È€ôÍ•ÑQ¥µ•½ÕÐ  ¤€ôø™•Ñ¡•¹•É…Ñ•‘%µ…•Ì ¤°€ÌÀÀÀ¤ì(€ô)ô((¼¿¦'š.§–nûž&)™Õ¹Ñ¥½¸Í•±•Ñ%µ…”¡¥¹‘•àè¹Õµ‰•È¤ì(€½¹ÍÐ¥µœ€ôÉ•ÍÕ±Ñ%µ…•Ì¹Ù…±Õ•m¥¹‘•átì(€¥˜€¡¥µœ¹ÍÑ…Ñ”€ôôô€‹–ÞË–º3š"@ˆ¤ì(€€€Í•±•Ñ•‘%µ…•%¹‘•à¹Ù…±Õ”€ô¥¹‘•àì(€€€Ý¥¹‘½Ü¸‘µ•ÍÍ…”¹ÍÕ•ÍÌ ‘Ð ‰Ý½É­‰•¹ ¹…ÍÍ•ÑÌ¹•¸¹¥µ…•M•±•Ñ•ˆ¤¤ì(€ô)ô((¼¿–"ƒ¦f“–nûž&)™Õ¹Ñ¥½¸‘•±•Ñ•%µ…”¡¥èÍÑÉ¥¹œð¹Õµ‰•È°¥¹‘•àè¹Õµ‰•È¤ì(€½¹ÍÐ‘¥…±½œ€ô¥…±½A±Õ¥¸¹½¹™¥É´¡ì(€€€¡•…‘•Èè€‘Ð ‰Ý½É­‰•¹ ¹…ÍÍ•ÑÌ¹½¹™¥Éµ•±•Ñ•!•…‘•Èˆ¤°(€€€‰½‘äè€‘Ð ‰Ý½É­‰•¹ ¹…ÍÍ•ÑÌ¹½¹™¥Éµ•±•Ñ•	½‘äˆ¤°(€€€½¹™¥Éµ	Ñ¸è€‘Ð ‰Ý½É­‰•¹ ¹…ÍÍ•ÑÌ¹‘•±•Ñ•	Ñ¸ˆ¤°(€€€…¹•±	Ñ¸è€‘Ð ‰Ý½É­‰•¹ ¹…ÍÍ•ÑÌ¹…¹•±	Ñ¸ˆ¤°(€€€Ñ¡•µ”è€‰Ý…É¹¥¹œˆ°(€€€½¹½¹™¥É´è…Íå¹Œ€ ¤€ôøì(€€€€€ÑÉäì(€€€€€€€…Ý…¥Ð…á¥½Ì¹Á½ÍÐ ˆ½…ÍÍ•ÑÌ½‘•±%µ…”ˆ°ì¥ô¤ì(€€€€€€€Ý¥¹‘½Ü¸‘µ•ÍÍ…”¹ÍÕ•ÍÌ ‘Ð ‰Ý½É­‰•¹ ¹…ÍÍ•ÑÌ¹‘•±•Ñ•MÕ•ÍÌˆ¤¤ì(€€€€€€€É•ÍÕ±Ñ%µ…•Ì¹Ù…±Õ”¹ÍÁ±¥”¡¥¹‘•à°€Ä¤ì(€€€€€€€¥˜€¡Í•±•Ñ•‘%µ…•%¹‘•à¹Ù…±Õ”€ôôô¥¹‘•à¤ì(€€€€€€€€€Í•±•Ñ•‘%µ…•%¹‘•à¹Ù…±Õ”€ô¹Õ±°ì(€€€€€€€ô•±Í”¥˜€¡Í•±•Ñ•‘%µ…•%¹‘•à¹Ù…±Õ”€„ôô¹Õ±°€˜˜Í•±•Ñ•‘%µ…•%¹‘•à¹Ù…±Õ”€ø¥¹‘•à¤ì(€€€€€€€€€Í•±•Ñ•‘%µ…•%¹‘•à¹Ù…±Õ”´´ì(€€€€€€€ô(€€€€€€€‘¥…±½œ¹‘•ÍÑÉ½ä ¤ì(€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€Ý¥¹‘½Ü¸‘µ•ÍÍ…”¹•ÉÉ½È¡